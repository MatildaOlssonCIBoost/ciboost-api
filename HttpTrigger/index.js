// Required schema for budget row source tracking (import provenance):
//   ALTER TABLE BudgetRows ADD Source NVARCHAR(50) NULL, ImportedAt DATE NULL;
//
// Required schema for budget version type (Likviditet vs Resultat):
//   ALTER TABLE BudgetVersions ADD BudgetType NVARCHAR(20) NULL;
//
// Required schema for per-revenue-item renewal outcome amount:
//   ALTER TABLE RenewalOutcomes ADD Amount INT NULL;
//
// Customer fields Koncern/Antal anställda/Bransch (om de saknas — annars no-op):
//   ALTER TABLE Customers ADD ParentCompany NVARCHAR(200) NULL;
//   ALTER TABLE Customers ADD Employees INT NULL;
//   ALTER TABLE Customers ADD Industry NVARCHAR(100) NULL;
//
// Prospect Team/avdelning + Koncern (enhetlig kortstruktur):
//   ALTER TABLE Prospects ADD SubName NVARCHAR(200) NULL;
//   ALTER TABLE Prospects ADD ParentCompany NVARCHAR(200) NULL;
//   ALTER TABLE Prospects ADD Employees INT NULL;  -- om kolumnen saknas
// Skrivs feltåligt i prospects POST/PUT så saknade kolumner inte bryter sparning.
//
// Prospect-intäktsposter (server-side). Om tabellen saknas, skapa den:
//   CREATE TABLE ProspectRevenues (
//     Id INT IDENTITY(1,1) PRIMARY KEY,
//     ProspectId INT NOT NULL,
//     Type NVARCHAR(50), Amount INT, Probability INT NULL,
//     DateFrom DATE NULL, DateTo DATE NULL, Description NVARCHAR(MAX) NULL,
//     InvoiceDate DATE NULL, Paid INT NULL, PaymentDate DATE NULL,
//     CreatedAt DATETIME DEFAULT GETDATE()
//   );
// Finns tabellen redan men saknar viktningskolumnen:
//   ALTER TABLE ProspectRevenues ADD Probability INT NULL;
// Dessa skrivs via en feltålig separat UPDATE i customers PUT, så saknade
// kolumner bryter inte resten av kundsparningen.
//
// Required schema changes for risk-snapshot / renewal-outcome / pipeline analysis:
//   ALTER TABLE Prospects ADD ClosedAt DATE NULL;
//   CREATE TABLE RiskSnapshots (
//     Id INT IDENTITY(1,1) PRIMARY KEY,
//     CustomerId INT NOT NULL,
//     CreatedAt DATETIME DEFAULT GETDATE(),
//     TriggerType NVARCHAR(50) NOT NULL,  -- manual, auto_90d, auto_30d, auto_15d
//     Score INT, RiskLevel NVARCHAR(20), RenewalProb INT,
//     StepBase INT, Satisfaction INT, ActivityLevel NVARCHAR(30),
//     Economy NVARCHAR(30), Focus NVARCHAR(30), DaysToLicenseEnd INT
//   );
//   CREATE TABLE RenewalOutcomes (
//     Id INT IDENTITY(1,1) PRIMARY KEY,
//     CustomerId INT NOT NULL,
//     RiskSnapshotId INT NULL,
//     Outcome NVARCHAR(30) NOT NULL,  -- Förnyade, Churnade, Pausad, Ej registrerat
//     DecisionDate DATE NULL,
//     Notes NVARCHAR(MAX) NULL,
//     CreatedAt DATETIME DEFAULT GETDATE()
//   );
// Until those tables/columns exist, riskSnapshot/renewalOutcome/modelAnalysis
// and the ClosedAt stamping in prospects PUT will fail with "Invalid column name".

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

const sql = require('mssql');
const config = {
  server: 'ciboost-server.database.windows.net',
  database: 'ciboost-db',
  user: 'ciboostadmin',
  password: process.env.DB_PASSWORD,
  options: { encrypt: true, trustServerCertificate: false }
};
let pool;
async function getPool() {
  if (!pool) pool = await sql.connect(config);
  return pool;
}

// Skapa kolumner self-healing (idempotent) så att Koncern/Team/Antal anställda/
// Bransch kan sparas utan manuell SQL. Körs en gång per kall start.
let _colsEnsured = false;
async function ensureSchemaColumns(db) {
  if (_colsEnsured) return;
  try {
    await db.request().query(`
      IF COL_LENGTH('Prospects','SubName') IS NULL ALTER TABLE Prospects ADD SubName NVARCHAR(200) NULL;
      IF COL_LENGTH('Prospects','ParentCompany') IS NULL ALTER TABLE Prospects ADD ParentCompany NVARCHAR(200) NULL;
      IF COL_LENGTH('Prospects','Employees') IS NULL ALTER TABLE Prospects ADD Employees INT NULL;
      IF COL_LENGTH('Prospects','Industry') IS NULL ALTER TABLE Prospects ADD Industry NVARCHAR(100) NULL;
      IF COL_LENGTH('Prospects','ClosedAt') IS NULL ALTER TABLE Prospects ADD ClosedAt DATE NULL;
      IF COL_LENGTH('Prospects','Email') IS NULL ALTER TABLE Prospects ADD Email NVARCHAR(200) NULL;
      IF COL_LENGTH('Prospects','Phone') IS NULL ALTER TABLE Prospects ADD Phone NVARCHAR(60) NULL;
      IF COL_LENGTH('Prospects','NextActionType') IS NULL ALTER TABLE Prospects ADD NextActionType NVARCHAR(100) NULL;
      IF COL_LENGTH('Prospects','NextActionDate') IS NULL ALTER TABLE Prospects ADD NextActionDate DATE NULL;
      IF COL_LENGTH('Prospects','WaitingForResponse') IS NULL ALTER TABLE Prospects ADD WaitingForResponse BIT NULL;
      IF COL_LENGTH('Prospects','RevenueCategory') IS NULL ALTER TABLE Prospects ADD RevenueCategory NVARCHAR(50) NULL;
      IF COL_LENGTH('Prospects','ExpectedStartMonth') IS NULL ALTER TABLE Prospects ADD ExpectedStartMonth DATE NULL;
      IF COL_LENGTH('Prospects','ValueMin') IS NULL ALTER TABLE Prospects ADD ValueMin INT NULL;
      IF COL_LENGTH('Prospects','ValueMax') IS NULL ALTER TABLE Prospects ADD ValueMax INT NULL;
      IF COL_LENGTH('Prospects','LostReason') IS NULL ALTER TABLE Prospects ADD LostReason NVARCHAR(100) NULL;
      IF COL_LENGTH('Customers','ParentCompany') IS NULL ALTER TABLE Customers ADD ParentCompany NVARCHAR(200) NULL;
      IF COL_LENGTH('Customers','Employees') IS NULL ALTER TABLE Customers ADD Employees INT NULL;
      IF COL_LENGTH('Customers','Industry') IS NULL ALTER TABLE Customers ADD Industry NVARCHAR(100) NULL;
      IF OBJECT_ID('RenewalOutcomes') IS NOT NULL AND COL_LENGTH('RenewalOutcomes','ChurnReason') IS NULL ALTER TABLE RenewalOutcomes ADD ChurnReason NVARCHAR(100) NULL;
    `);
    _colsEnsured = true;
  } catch (e) { /* saknar ALTER-rättighet — fält sparas först när kolumnerna finns */ }
}

function calculateRiskScore({ steps = [], satisfaction = 0, activityLevel = '', economy = 'unknown', focus = 'unknown' } = {}) {
  const stepPoints = [5, 10, 35, 65, 95, 100];
  let stepBase = 0;
  for (let i = 0; i < 6; i++) if (steps[i]) stepBase = stepPoints[i];
  let score = stepBase;
  const satAdj = { 1: -100, 2: -75, 3: -25, 4: 0, 5: 25 };
  score += satAdj[satisfaction] || 0;
  const actAdj = { '': -50, 'ingen': -50, 'Låg': -25, 'låg': -25, 'Medium': 25, 'medium': 25, 'Hög': 50, 'hög': 50 };
  score += actAdj[activityLevel] != null ? actAdj[activityLevel] : 0;
  const ecoAdj = { large_savings: -50, savings: -25, unknown: 0, good: 25 };
  score += ecoAdj[economy] != null ? ecoAdj[economy] : 0;
  const focAdj = { strong_other: -50, other: -25, unknown: 0, priority: 25 };
  score += focAdj[focus] != null ? focAdj[focus] : 0;
  const riskLevel = score < 50 ? 'Hög' : score <= 120 ? 'Medium' : 'Låg';
  const anchors = [[-150, 5], [0, 45], [50, 55], [120, 80], [200, 95]];
  let prob;
  if (score <= anchors[0][0]) prob = anchors[0][1];
  else if (score >= anchors[anchors.length - 1][0]) prob = anchors[anchors.length - 1][1];
  else {
    for (let i = 0; i < anchors.length - 1; i++) {
      const [x1, y1] = anchors[i], [x2, y2] = anchors[i + 1];
      if (score >= x1 && score <= x2) { prob = y1 + (y2 - y1) * ((score - x1) / (x2 - x1)); break; }
    }
  }
  const renewalProb = Math.round(Math.max(5, Math.min(95, prob)));
  return { score, stepBase, riskLevel, renewalProb };
}

async function insertRiskSnapshot(db, row) {
  return db.request()
    .input('CustomerId', sql.Int, row.customerId)
    .input('TriggerType', sql.NVarChar, row.triggerType || 'manual')
    .input('Score', sql.Int, row.score)
    .input('RiskLevel', sql.NVarChar, row.riskLevel)
    .input('RenewalProb', sql.Int, row.renewalProb)
    .input('StepBase', sql.Int, row.stepBase || 0)
    .input('Satisfaction', sql.Int, row.satisfaction || 0)
    .input('ActivityLevel', sql.NVarChar, row.activityLevel || '')
    .input('Economy', sql.NVarChar, row.economy || 'unknown')
    .input('Focus', sql.NVarChar, row.focus || 'unknown')
    .input('DaysToLicenseEnd', sql.Int, row.daysToLicenseEnd != null ? row.daysToLicenseEnd : null)
    .query(`INSERT INTO RiskSnapshots (CustomerId,TriggerType,Score,RiskLevel,RenewalProb,StepBase,Satisfaction,ActivityLevel,Economy,Focus,DaysToLicenseEnd)
            OUTPUT INSERTED.Id, INSERTED.CreatedAt
            VALUES (@CustomerId,@TriggerType,@Score,@RiskLevel,@RenewalProb,@StepBase,@Satisfaction,@ActivityLevel,@Economy,@Focus,@DaysToLicenseEnd)`);
}

module.exports = async function (context, req) {
  const method = req.method.toUpperCase();
  const path = req.params.path || '';

  if (method === 'OPTIONS') {
    context.res = { status: 204, headers: corsHeaders, body: '' };
    return;
  }

  try {
    const db = await getPool();
    await ensureSchemaColumns(db);

    if (path === 'prospects') {
      if (method === 'GET') {
        const result = await db.request().query('SELECT * FROM Prospects ORDER BY CreatedAt DESC');
        return respond(context, 200, result.recordset);
      }
      if (method === 'POST') {
        const p = req.body;
        await db.request()
          .input('Company', sql.NVarChar, p.company)
          .input('Industry', sql.NVarChar, p.industry)
          .input('Contact', sql.NVarChar, p.contact)
          .input('Role', sql.NVarChar, p.role)
          .input('Source', sql.NVarChar, p.source)
          .input('Owner', sql.NVarChar, p.owner)
          .input('Stage', sql.NVarChar, p.stage)
          .input('Score', sql.Int, p.score)
          .input('Value', sql.Int, p.value)
          .input('Probability', sql.Int, p.probability)
          .input('LastContact', sql.Date, p.lastContact || null)
          .input('NextMeeting', sql.Date, p.nextMeeting || null)
          .input('Notes', sql.NVarChar, p.notes)
          .query(`INSERT INTO Prospects (Company,Industry,Contact,Role,Source,Owner,Stage,Score,Value,Probability,LastContact,NextMeeting,Notes)
                  OUTPUT INSERTED.Id
                  VALUES (@Company,@Industry,@Contact,@Role,@Source,@Owner,@Stage,@Score,@Value,@Probability,@LastContact,@NextMeeting,@Notes)`)
          .then(async r => {
            const newId = r.recordset && r.recordset[0] ? r.recordset[0].Id : null;
            if (newId) {
              try {
                await db.request()
                  .input('Id', sql.Int, newId)
                  .input('SubName', sql.NVarChar, p.subName != null ? p.subName : null)
                  .input('ParentCompany', sql.NVarChar, p.parentCompany != null ? p.parentCompany : null)
                  .input('Employees', sql.Int, p.employees != null ? p.employees : null)
                  .query('UPDATE Prospects SET SubName=@SubName, ParentCompany=@ParentCompany, Employees=@Employees WHERE Id=@Id');
              } catch (e) { /* kolumnerna finns ännu inte */ }
              try {
                await db.request()
                  .input('Id', sql.Int, newId)
                  .input('Email', sql.NVarChar, p.email != null ? p.email : null)
                  .input('Phone', sql.NVarChar, p.phone != null ? p.phone : null)
                  .input('NextActionType', sql.NVarChar, p.nextActionType != null ? p.nextActionType : null)
                  .input('NextActionDate', sql.Date, p.nextActionDate || null)
                  .input('WaitingForResponse', sql.Bit, p.waitingForResponse ? 1 : 0)
                  .input('RevenueCategory', sql.NVarChar, p.revenueCategory != null ? p.revenueCategory : null)
                  .input('ExpectedStartMonth', sql.Date, p.expectedStartMonth || null)
                  .query('UPDATE Prospects SET Email=@Email,Phone=@Phone,NextActionType=@NextActionType,NextActionDate=@NextActionDate,WaitingForResponse=@WaitingForResponse,RevenueCategory=@RevenueCategory,ExpectedStartMonth=@ExpectedStartMonth WHERE Id=@Id');
              } catch (e) { /* kolumnerna finns ännu inte */ }
            }
          });
        return respond(context, 201, { message: 'Skapad' });
      }
    }

    // Prospect-intäktsposter (server-side i ProspectRevenues). Måste ligga FÖRE
    // det generiska prospects/-blocket så att /revenues-vägar inte tolkas som
    // uppdatering/borttagning av själva prospektet.
    if (path.startsWith('prospects/') && path.includes('/revenues')) {
      const prospectId = path.split('/')[1];
      const revenueId = path.split('/')[3];
      if (method === 'GET') {
        const result = await db.request().input('ProspectId', sql.Int, prospectId)
          .query('SELECT * FROM ProspectRevenues WHERE ProspectId=@ProspectId ORDER BY DateFrom ASC');
        return respond(context, 200, result.recordset);
      }
      if (method === 'POST') {
        const b = req.body || {};
        const ins = await db.request()
          .input('ProspectId', sql.Int, prospectId)
          .input('Type', sql.NVarChar, b.Type)
          .input('Amount', sql.Int, b.Amount || 0)
          .input('Probability', sql.Int, b.Probability != null ? b.Probability : null)
          .input('DateFrom', sql.Date, b.DateFrom || null)
          .input('DateTo', sql.Date, b.DateTo || null)
          .input('Description', sql.NVarChar, b.Description || null)
          .input('InvoiceDate', sql.Date, b.InvoiceDate || null)
          .input('Paid', sql.Int, b.Paid ? 1 : 0)
          .input('PaymentDate', sql.Date, b.PaymentDate || null)
          .query(`INSERT INTO ProspectRevenues (ProspectId,Type,Amount,Probability,DateFrom,DateTo,Description,InvoiceDate,Paid,PaymentDate)
                  OUTPUT INSERTED.Id
                  VALUES (@ProspectId,@Type,@Amount,@Probability,@DateFrom,@DateTo,@Description,@InvoiceDate,@Paid,@PaymentDate)`);
        return respond(context, 201, { message: 'Intäkt sparad', Id: ins.recordset[0] ? ins.recordset[0].Id : null });
      }
      if (method === 'PUT' && revenueId) {
        const b = req.body || {};
        await db.request()
          .input('Id', sql.Int, revenueId)
          .input('Type', sql.NVarChar, b.Type)
          .input('Amount', sql.Int, b.Amount || 0)
          .input('Probability', sql.Int, b.Probability != null ? b.Probability : null)
          .input('DateFrom', sql.Date, b.DateFrom || null)
          .input('DateTo', sql.Date, b.DateTo || null)
          .input('Description', sql.NVarChar, b.Description || null)
          .input('InvoiceDate', sql.Date, b.InvoiceDate || null)
          .input('Paid', sql.Int, b.Paid ? 1 : 0)
          .input('PaymentDate', sql.Date, b.PaymentDate || null)
          .query(`UPDATE ProspectRevenues SET Type=@Type,Amount=@Amount,Probability=@Probability,
                  DateFrom=@DateFrom,DateTo=@DateTo,Description=@Description,InvoiceDate=@InvoiceDate,
                  Paid=@Paid,PaymentDate=@PaymentDate WHERE Id=@Id`);
        return respond(context, 200, { message: 'Uppdaterad' });
      }
      if (method === 'DELETE' && revenueId) {
        await db.request().input('Id', sql.Int, revenueId)
          .query('DELETE FROM ProspectRevenues WHERE Id=@Id');
        return respond(context, 200, { message: 'Borttagen' });
      }
    }

    if (path.startsWith('prospects/') && !path.includes('/revenues')) {
      const id = path.split('/')[1];
      if (method === 'PUT') {
        const p = req.body;
        // Kärnkolumner (samma som POST) — finns garanterat, får aldrig fela.
        // ClosedAt och övriga (eventuellt saknade) kolumner skrivs i egna
        // feltåliga UPDATE-block nedan så att ETT saknat fält aldrig kraschar
        // hela sparningen (det var orsaken till det röda "Fel"-märket).
        await db.request()
          .input('Id', sql.Int, id)
          .input('Company', sql.NVarChar, p.company)
          .input('Industry', sql.NVarChar, p.industry)
          .input('Contact', sql.NVarChar, p.contact)
          .input('Role', sql.NVarChar, p.role)
          .input('Source', sql.NVarChar, p.source)
          .input('Owner', sql.NVarChar, p.owner)
          .input('Stage', sql.NVarChar, p.stage)
          .input('Score', sql.Int, p.score)
          .input('Value', sql.Int, p.value)
          .input('Probability', sql.Int, p.probability)
          .input('LastContact', sql.Date, p.lastContact || null)
          .input('NextMeeting', sql.Date, p.nextMeeting || null)
          .input('Notes', sql.NVarChar, p.notes)
          .query(`UPDATE Prospects SET Company=@Company,Industry=@Industry,Contact=@Contact,Role=@Role,
        Source=@Source,Owner=@Owner,Stage=@Stage,Score=@Score,Value=@Value,Probability=@Probability,
        LastContact=@LastContact,NextMeeting=@NextMeeting,Notes=@Notes,UpdatedAt=GETDATE() WHERE Id=@Id`);
        // Värde-spann + förlustorsak.
        try {
          await db.request().input('Id', sql.Int, id)
            .input('ValueMin', sql.Int, p.valueMin || null)
            .input('ValueMax', sql.Int, p.valueMax || null)
            .input('LostReason', sql.NVarChar, p.lostReason || null)
            .query('UPDATE Prospects SET ValueMin=@ValueMin,ValueMax=@ValueMax,LostReason=@LostReason WHERE Id=@Id');
        } catch (e) {}
        // ClosedAt-stämpling (kolumnen kan saknas).
        try {
          await db.request().input('Id', sql.Int, id).input('Stage', sql.NVarChar, p.stage)
            .query(`UPDATE Prospects SET ClosedAt=CASE WHEN @Stage IN ('Closed Won','Closed Lost') AND ClosedAt IS NULL THEN CAST(GETDATE() AS DATE) ELSE ClosedAt END WHERE Id=@Id`);
        } catch (e) {}
        // Team/avdelning + Koncern + Antal anställda.
        try {
          await db.request().input('Id', sql.Int, id)
            .input('SubName', sql.NVarChar, p.subName != null ? p.subName : null)
            .input('ParentCompany', sql.NVarChar, p.parentCompany != null ? p.parentCompany : null)
            .input('Employees', sql.Int, p.employees != null ? p.employees : null)
            .query('UPDATE Prospects SET SubName=@SubName, ParentCompany=@ParentCompany, Employees=@Employees WHERE Id=@Id');
        } catch (e) {}
        // Kontaktuppgifter + nästa steg + pipeline-metadata.
        try {
          await db.request().input('Id', sql.Int, id)
            .input('Email', sql.NVarChar, p.email != null ? p.email : null)
            .input('Phone', sql.NVarChar, p.phone != null ? p.phone : null)
            .input('NextActionType', sql.NVarChar, p.nextActionType != null ? p.nextActionType : null)
            .input('NextActionDate', sql.Date, p.nextActionDate || null)
            .input('WaitingForResponse', sql.Bit, p.waitingForResponse ? 1 : 0)
            .input('RevenueCategory', sql.NVarChar, p.revenueCategory != null ? p.revenueCategory : null)
            .input('ExpectedStartMonth', sql.Date, p.expectedStartMonth || null)
            .query('UPDATE Prospects SET Email=@Email,Phone=@Phone,NextActionType=@NextActionType,NextActionDate=@NextActionDate,WaitingForResponse=@WaitingForResponse,RevenueCategory=@RevenueCategory,ExpectedStartMonth=@ExpectedStartMonth WHERE Id=@Id');
        } catch (e) {}
        return respond(context, 200, { message: 'Uppdaterad' });
      }
      if (method === 'DELETE') {
        await db.request().input('Id', sql.Int, id)
          .query('DELETE FROM Activities WHERE ProspectId=@Id; DELETE FROM Prospects WHERE Id=@Id');
        return respond(context, 200, { message: 'Borttagen' });
      }
    }

    if (path.startsWith('customers/') && path.includes('/teams')) {
      const customerId = path.split('/')[1];
      if (method === 'GET') {
        const result = await db.request().input('CustomerId', sql.Int, customerId)
          .query('SELECT * FROM CustomerTeams WHERE CustomerId=@CustomerId');
        return respond(context, 200, result.recordset);
      }
      if (method === 'POST') {
        const t = req.body;
        await db.request()
          .input('CustomerId', sql.Int, customerId)
          .input('TeamName', sql.NVarChar, t.teamName)
          .input('MeetingLeader1', sql.NVarChar, t.meetingLeader1)
          .input('MeetingLeader1Email', sql.NVarChar, t.meetingLeader1Email)
          .input('MeetingLeader2', sql.NVarChar, t.meetingLeader2)
          .input('MeetingLeader2Email', sql.NVarChar, t.meetingLeader2Email)
          .query('INSERT INTO CustomerTeams (CustomerId,TeamName,MeetingLeader1,MeetingLeader1Email,MeetingLeader2,MeetingLeader2Email) VALUES (@CustomerId,@TeamName,@MeetingLeader1,@MeetingLeader1Email,@MeetingLeader2,@MeetingLeader2Email)');
        return respond(context, 201, { message: 'Team sparat' });
      }
      if (method === 'DELETE') {
        await db.request().input('CustomerId', sql.Int, customerId)
          .query('DELETE FROM CustomerTeams WHERE CustomerId=@CustomerId');
        return respond(context, 200, { message: 'Teams borttagna' });
      }
    }

    if (path.startsWith('customers/') && path.includes('/admins')) {
      const customerId = path.split('/')[1];
      if (method === 'GET') {
        const result = await db.request().input('CustomerId', sql.Int, customerId)
          .query('SELECT * FROM CustomerAdmins WHERE CustomerId=@CustomerId');
        return respond(context, 200, result.recordset);
      }
      if (method === 'POST') {
        const a = req.body;
        await db.request()
          .input('CustomerId', sql.Int, customerId)
          .input('Name', sql.NVarChar, a.name)
          .input('Email', sql.NVarChar, a.email)
          .input('Phone', sql.NVarChar, a.phone)
          .query('INSERT INTO CustomerAdmins (CustomerId,Name,Email,Phone) VALUES (@CustomerId,@Name,@Email,@Phone)');
        return respond(context, 201, { message: 'Admin sparad' });
      }
      if (method === 'DELETE') {
        await db.request().input('CustomerId', sql.Int, customerId)
          .query('DELETE FROM CustomerAdmins WHERE CustomerId=@CustomerId');
        return respond(context, 200, { message: 'Admins borttagna' });
      }
    }

    if (path.startsWith('activities/customer/')) {
      const customerId = path.split('/')[2];
      if (method === 'GET') {
        const result = await db.request().input('CustomerId', sql.Int, customerId)
          .query('SELECT * FROM CustomerActivities WHERE CustomerId=@CustomerId ORDER BY CreatedAt DESC');
        return respond(context, 200, result.recordset);
      }
      if (method === 'POST') {
        const a = req.body;
        await db.request()
          .input('CustomerId', sql.Int, customerId)
          .input('Type', sql.NVarChar, a.type)
          .input('Note', sql.NVarChar, a.note)
          .input('CreatedBy', sql.NVarChar, a.createdBy)
          .query('INSERT INTO CustomerActivities (CustomerId,Type,Note,CreatedBy) VALUES (@CustomerId,@Type,@Note,@CreatedBy)');
        return respond(context, 201, { message: 'Aktivitet sparad' });
      }
      // /activities/customer/:customerId/:activityId — redigera/ta bort en post.
      const custActId = path.split('/')[3];
      if (method === 'PUT' && custActId) {
        const a = req.body || {};
        await db.request()
          .input('Id', sql.Int, custActId)
          .input('Type', sql.NVarChar, a.type)
          .input('Note', sql.NVarChar, a.note)
          .input('CreatedAt', sql.DateTime, a.date || null)
          .query('UPDATE CustomerActivities SET Type=@Type, Note=@Note, CreatedAt=COALESCE(@CreatedAt,CreatedAt) WHERE Id=@Id');
        return respond(context, 200, { message: 'Uppdaterad' });
      }
      if (method === 'DELETE' && custActId) {
        await db.request().input('Id', sql.Int, custActId)
          .query('DELETE FROM CustomerActivities WHERE Id=@Id');
        return respond(context, 200, { message: 'Borttagen' });
      }
    }

    if (path.startsWith('revenues/') && path.includes('/commissions')) {
      const revenueId = path.split('/')[1];
      if (method === 'GET') {
        const result = await db.request().input('RevenueId', sql.Int, revenueId)
          .query('SELECT * FROM CustomerCommissions WHERE RevenueId=@RevenueId ORDER BY CreatedAt ASC');
        return respond(context, 200, result.recordset);
      }
      if (method === 'POST') {
        const c = req.body;
        await db.request()
          .input('RevenueId', sql.Int, revenueId)
          .input('CustomerId', sql.Int, c.customerId)
          .input('Recipient', sql.NVarChar, c.recipient)
          .input('CommissionPercent', sql.Decimal(5,2), c.commissionPercent || null)
          .input('Amount', sql.Int, c.amount)
          .input('Notes', sql.NVarChar, c.notes || null)
          .query('INSERT INTO CustomerCommissions (RevenueId,CustomerId,Recipient,CommissionPercent,Amount,Notes) VALUES (@RevenueId,@CustomerId,@Recipient,@CommissionPercent,@Amount,@Notes)');
        return respond(context, 201, { message: 'Provision sparad' });
      }
      if (method === 'DELETE') {
        await db.request().input('RevenueId', sql.Int, revenueId)
          .query('DELETE FROM CustomerCommissions WHERE RevenueId=@RevenueId');
        return respond(context, 200, { message: 'Borttagen' });
      }
    }

    if (path.startsWith('commissions/')) {
      const commId = path.split('/')[1];
      if (method === 'PUT') {
        const c = req.body;
        await db.request()
          .input('Id', sql.Int, commId)
          .input('PaidOut', sql.Int, c.paidOut || 0)
          .input('PaidOutDate', sql.Date, c.paidOutDate || null)
          .query('UPDATE CustomerCommissions SET PaidOut=@PaidOut, PaidOutDate=@PaidOutDate WHERE Id=@Id');
        return respond(context, 200, { message: 'Uppdaterad' });
      }
      if (method === 'DELETE') {
        await db.request().input('Id', sql.Int, commId)
          .query('DELETE FROM CustomerCommissions WHERE Id=@Id');
        return respond(context, 200, { message: 'Borttagen' });
      }
    }

    if (path === 'commissions') {
      if (method === 'GET') {
        const result = await db.request().query(`
          SELECT cc.*, cr.Type as RevenueType, cr.Amount as RevenueAmount, c.Company, c.SubName
          FROM CustomerCommissions cc
          JOIN CustomerRevenues cr ON cc.RevenueId = cr.Id
          JOIN Customers c ON cc.CustomerId = c.Id
          ORDER BY cc.CreatedAt DESC`);
        return respond(context, 200, result.recordset);
      }
    }

    if (path.startsWith('customers/') && path.includes('/revenues')) {
      const customerId = path.split('/')[1];
      if (method === 'GET') {
        const result = await db.request().input('CustomerId', sql.Int, customerId)
          .query('SELECT * FROM CustomerRevenues WHERE CustomerId=@CustomerId ORDER BY DateFrom ASC');
        return respond(context, 200, result.recordset);
      }
      if (method === 'POST') {
        const r = req.body;
        await db.request()
          .input('CustomerId', sql.Int, customerId)
          .input('Type', sql.NVarChar, r.type)
          .input('Amount', sql.Int, r.amount)
          .input('DateFrom', sql.Date, r.dateFrom || null)
          .input('DateTo', sql.Date, r.dateTo || null)
          .input('Description', sql.NVarChar, r.description || null)
          .query('INSERT INTO CustomerRevenues (CustomerId,Type,Amount,DateFrom,DateTo,Description) VALUES (@CustomerId,@Type,@Amount,@DateFrom,@DateTo,@Description)');
        const inserted = await db.request().input('CustomerId', sql.Int, customerId)
          .query('SELECT TOP 1 Id FROM CustomerRevenues WHERE CustomerId=@CustomerId ORDER BY CreatedAt DESC');
        return respond(context, 201, { message: 'Intäkt sparad', id: inserted.recordset[0]?.Id });
      }
      if (method === 'PUT') {
        const revenueId = path.split('/')[3];
        const r = req.body;
        await db.request()
          .input('Id', sql.Int, revenueId)
          .input('Type', sql.NVarChar, r.type)
          .input('Amount', sql.Int, r.amount)
          .input('DateFrom', sql.Date, r.dateFrom || null)
          .input('DateTo', sql.Date, r.dateTo || null)
          .input('Description', sql.NVarChar, r.description || null)
          .query('UPDATE CustomerRevenues SET Type=@Type,Amount=@Amount,DateFrom=@DateFrom,DateTo=@DateTo,Description=@Description WHERE Id=@Id');
        return respond(context, 200, { message: 'Uppdaterad' });
      }
      if (method === 'DELETE') {
        const revenueId = path.split('/')[3];
        if (revenueId) {
          await db.request().input('Id', sql.Int, revenueId)
            .query('DELETE FROM CustomerCommissions WHERE RevenueId=@Id; DELETE FROM CustomerRevenues WHERE Id=@Id');
        } else {
          await db.request().input('CustomerId', sql.Int, customerId)
            .query('DELETE FROM CustomerCommissions WHERE CustomerId=@CustomerId; DELETE FROM CustomerRevenues WHERE CustomerId=@CustomerId');
        }
        return respond(context, 200, { message: 'Borttagen' });
      }
    }

    if (path === 'revenues') {
      if (method === 'GET') {
        const result = await db.request().query(`
          SELECT cr.*, c.Company, c.SubName, c.Owner, c.LicenseStart, c.LicenseEnd
          FROM CustomerRevenues cr
          JOIN Customers c ON cr.CustomerId = c.Id
          ORDER BY cr.DateFrom ASC`);
        return respond(context, 200, result.recordset);
      }
    }

    if (path.startsWith('customers/') && !path.includes('/teams') && !path.includes('/admins') && !path.includes('/revenues')) {
      const id = path.split('/')[1];
      if (method === 'PUT') {
        const c = req.body;
        await db.request()
          .input('Id', sql.Int, id)
          .input('Company', sql.NVarChar, c.company)
          .input('SubName', sql.NVarChar, c.subName)
          .input('Contact', sql.NVarChar, c.contact)
          .input('ContactRole', sql.NVarChar, c.contactRole)
          .input('ContactEmail', sql.NVarChar, c.contactEmail)
          .input('ContactPhone', sql.NVarChar, c.contactPhone)
          .input('CustomerSince', sql.Date, c.customerSince || null)
          .input('LicenseType', sql.NVarChar, c.licenseType)
          .input('LicenseStart', sql.Date, c.licenseStart || null)
          .input('LicenseEnd', sql.Date, c.licenseEnd || null)
          .input('ARR', sql.Int, c.arr)
          .input('ARR_Fixed', sql.Int, c.arrFixed)
          .input('Revenue_Training', sql.Int, c.revenueTraining)
          .input('Revenue_Training_Date', sql.Date, c.revenueTrainingDate || null)
          .input('Revenue_Consulting', sql.Int, c.revenueConsulting)
          .input('Revenue_Consulting_Date', sql.Date, c.revenueConsultingDate || null)
          .input('Risk', sql.NVarChar, c.risk)
          .input('TeamName', sql.NVarChar, c.teamName)
          .input('MeetingLeader1', sql.NVarChar, c.meetingLeader1)
          .input('MeetingLeader1Email', sql.NVarChar, c.meetingLeader1Email)
          .input('MeetingLeader1Phone', sql.NVarChar, c.meetingLeader1Phone)
          .input('MeetingLeader2', sql.NVarChar, c.meetingLeader2)
          .input('MeetingLeader2Email', sql.NVarChar, c.meetingLeader2Email)
          .input('MeetingLeader2Phone', sql.NVarChar, c.meetingLeader2Phone)
          .input('CommissionSalesperson', sql.NVarChar, c.commissionSalesperson)
          .input('CommissionPercent', sql.Decimal(5,2), c.commissionPercent)
          .input('CommissionAmount', sql.Int, c.commissionAmount)
          .input('Notes', sql.NVarChar, c.notes)
          .input('Owner', sql.NVarChar, c.owner)
          .query(`UPDATE Customers SET
            Company=@Company, SubName=@SubName, Contact=@Contact, ContactRole=@ContactRole,
            ContactEmail=@ContactEmail, ContactPhone=@ContactPhone,
            CustomerSince=@CustomerSince, LicenseType=@LicenseType,
            LicenseStart=@LicenseStart, LicenseEnd=@LicenseEnd,
            ARR=@ARR, ARR_Fixed=@ARR_Fixed,
            Revenue_Training=@Revenue_Training, Revenue_Training_Date=@Revenue_Training_Date,
            Revenue_Consulting=@Revenue_Consulting, Revenue_Consulting_Date=@Revenue_Consulting_Date,
            Risk=@Risk, TeamName=@TeamName,
            MeetingLeader1=@MeetingLeader1, MeetingLeader1Email=@MeetingLeader1Email,
            MeetingLeader1Phone=@MeetingLeader1Phone, MeetingLeader2=@MeetingLeader2,
            MeetingLeader2Email=@MeetingLeader2Email, MeetingLeader2Phone=@MeetingLeader2Phone,
            CommissionSalesperson=@CommissionSalesperson, CommissionPercent=@CommissionPercent,
            CommissionAmount=@CommissionAmount, Notes=@Notes, Owner=@Owner
            WHERE Id=@Id`);
        // Koncern/Antal anställda/Bransch i en egen, feltålig UPDATE så att en
        // ev. saknad kolumn inte fäller hela kundsparningen.
        try {
          await db.request()
            .input('Id', sql.Int, id)
            .input('ParentCompany', sql.NVarChar, c.parentCompany != null ? c.parentCompany : null)
            .input('Employees', sql.Int, c.employees != null ? c.employees : null)
            .input('Industry', sql.NVarChar, c.industry != null ? c.industry : null)
            .query('UPDATE Customers SET ParentCompany=@ParentCompany, Employees=@Employees, Industry=@Industry WHERE Id=@Id');
        } catch (e) { /* kolumnerna finns ännu inte — se ALTER nedan i schemakommentaren */ }
        return respond(context, 200, { message: 'Uppdaterad' });
      }
      if (method === 'DELETE') {
        await db.request().input('Id', sql.Int, id).query(`
          DELETE FROM CustomerCommissions WHERE CustomerId=@Id;
          DELETE FROM CustomerTeams WHERE CustomerId=@Id;
          DELETE FROM CustomerAdmins WHERE CustomerId=@Id;
          DELETE FROM CustomerActivities WHERE CustomerId=@Id;
          DELETE FROM CustomerRevenues WHERE CustomerId=@Id;
          DELETE FROM Customers WHERE Id=@Id`);
        return respond(context, 200, { message: 'Kund borttagen' });
      }
    }

    if (path === 'customers') {
      if (method === 'GET') {
        const result = await db.request().query('SELECT * FROM Customers ORDER BY LicenseEnd ASC');
        return respond(context, 200, result.recordset);
      }
      if (method === 'POST') {
        const c = req.body;
        await db.request()
          .input('Company', sql.NVarChar, c.company)
          .input('Contact', sql.NVarChar, c.contact)
          .input('Owner', sql.NVarChar, c.owner)
          .input('SubName', sql.NVarChar, c.subName)
          .input('LicenseType', sql.NVarChar, c.licenseType)
          .input('LicenseStart', sql.Date, c.licenseStart || null)
          .input('LicenseEnd', sql.Date, c.licenseEnd || null)
          .input('ARR', sql.Int, c.arr)
          .input('ARR_Fixed', sql.Int, c.arrFixed)
          .input('Revenue_Training', sql.Int, c.revenueTraining)
          .input('Revenue_Training_Date', sql.Date, c.revenueTrainingDate || null)
          .input('Revenue_Consulting', sql.Int, c.revenueConsulting)
          .input('Revenue_Consulting_Date', sql.Date, c.revenueConsultingDate || null)
          .input('Risk', sql.NVarChar, c.risk)
          .input('Notes', sql.NVarChar, c.notes)
          .input('ParentCompany', sql.NVarChar, c.parentCompany != null ? c.parentCompany : null)
          .input('Employees', sql.Int, c.employees != null ? c.employees : null)
          .input('Industry', sql.NVarChar, c.industry != null ? c.industry : null)
          .query(`INSERT INTO Customers (Company,Contact,Owner,SubName,LicenseType,LicenseStart,LicenseEnd,ARR,ARR_Fixed,Revenue_Training,Revenue_Training_Date,Revenue_Consulting,Revenue_Consulting_Date,Risk,Notes,ParentCompany,Employees,Industry)
                  VALUES (@Company,@Contact,@Owner,@SubName,@LicenseType,@LicenseStart,@LicenseEnd,@ARR,@ARR_Fixed,@Revenue_Training,@Revenue_Training_Date,@Revenue_Consulting,@Revenue_Consulting_Date,@Risk,@Notes,@ParentCompany,@Employees,@Industry)`);
        return respond(context, 201, { message: 'Kund skapad' });
      }
    }

    // Koncern-sökning
    if (path === 'customers/by-parent' && method === 'GET') {
      const parent = req.query.name;
      const result = await db.request()
        .input('ParentCompany', sql.NVarChar, parent)
        .query('SELECT * FROM Customers WHERE ParentCompany=@ParentCompany ORDER BY LicenseEnd ASC');
      return respond(context, 200, result.recordset);
    }

    if (path === 'commission-recipients') {
      if (method === 'GET') {
        const result = await db.request().query('SELECT * FROM CommissionRecipients ORDER BY Name ASC');
        return respond(context, 200, result.recordset);
      }
      if (method === 'POST') {
        const r = req.body;
        await db.request().input('Name', sql.NVarChar, r.name)
          .query('INSERT INTO CommissionRecipients (Name) VALUES (@Name)');
        return respond(context, 201, { message: 'Mottagare skapad' });
      }
    }

    if (path === 'activities' && method === 'POST') {
      const a = req.body;
      await db.request()
        .input('ProspectId', sql.Int, a.prospectId)
        .input('Type', sql.NVarChar, a.type)
        .input('Note', sql.NVarChar, a.note)
        .input('CreatedBy', sql.NVarChar, a.createdBy)
        .query('INSERT INTO Activities (ProspectId,Type,Note,CreatedBy) VALUES (@ProspectId,@Type,@Note,@CreatedBy)');
      return respond(context, 201, { message: 'Aktivitet sparad' });
    }

    // PUT/DELETE /activities/:id — redigera/ta bort en enskild aktivitet (prospekt-tidslinje).
    if (path.startsWith('activities/') && /^\d+$/.test(path.split('/')[1] || '')) {
      const aid = path.split('/')[1];
      if (method === 'PUT') {
        const a = req.body || {};
        await db.request()
          .input('Id', sql.Int, aid)
          .input('Type', sql.NVarChar, a.type)
          .input('Note', sql.NVarChar, a.note)
          .input('CreatedAt', sql.DateTime, a.date || null)
          .query('UPDATE Activities SET Type=@Type, Note=@Note, CreatedAt=COALESCE(@CreatedAt,CreatedAt) WHERE Id=@Id');
        return respond(context, 200, { message: 'Uppdaterad' });
      }
      if (method === 'DELETE') {
        await db.request().input('Id', sql.Int, aid).query('DELETE FROM Activities WHERE Id=@Id');
        return respond(context, 200, { message: 'Borttagen' });
      }
    }

    if (path.startsWith('activities/prospect/')) {
      const id = path.split('/')[2];
      const result = await db.request().input('ProspectId', sql.Int, id)
        .query('SELECT * FROM Activities WHERE ProspectId=@ProspectId ORDER BY CreatedAt DESC');
      return respond(context, 200, result.recordset);
    }

    if (path === 'budget-versions') {
      if (method === 'GET') {
        const result = await db.request().query('SELECT * FROM BudgetVersions ORDER BY Year DESC, CreatedAt DESC');
        return respond(context, 200, result.recordset);
      }
      if (method === 'POST') {
        const b = req.body;
        await db.request()
          .input('Name', sql.NVarChar, b.name)
          .input('Year', sql.Int, b.year)
          .input('CreatedBy', sql.NVarChar, b.createdBy || '')
          .input('BudgetType', sql.NVarChar, b.budgetType || null)
          .query('INSERT INTO BudgetVersions (Name,Year,CreatedBy,BudgetType) VALUES (@Name,@Year,@CreatedBy,@BudgetType)');
        const r = await db.request().query('SELECT TOP 1 * FROM BudgetVersions ORDER BY CreatedAt DESC');
        return respond(context, 201, r.recordset[0]);
      }
    }

    if (path.startsWith('budget-versions/') && !path.includes('/rows')) {
      const versionId = path.split('/')[1];
      if (method === 'PUT') {
        const b = req.body;
        await db.request()
          .input('Id', sql.Int, versionId)
          .input('Name', sql.NVarChar, b.name)
          .input('Year', sql.Int, b.year)
          .input('BudgetType', sql.NVarChar, b.budgetType || null)
          .query('UPDATE BudgetVersions SET Name=@Name, Year=@Year, BudgetType=@BudgetType WHERE Id=@Id');
        return respond(context, 200, { message: 'Uppdaterad' });
      }
      if (method === 'DELETE') {
        await db.request().input('Id', sql.Int, versionId)
          .query('DELETE FROM BudgetRows WHERE VersionId=@Id; DELETE FROM BudgetVersions WHERE Id=@Id');
        return respond(context, 200, { message: 'Borttagen' });
      }
    }

    if (path.startsWith('budget-versions/') && path.includes('/rows')) {
      const versionId = path.split('/')[1];
      if (method === 'GET') {
        const result = await db.request().input('VersionId', sql.Int, versionId)
          .query('SELECT * FROM BudgetRows WHERE VersionId=@VersionId ORDER BY Category, SubCategory');
        return respond(context, 200, result.recordset);
      }
      if (method === 'POST') {
        const rows = req.body;
        await db.request().input('VersionId', sql.Int, versionId)
          .query('DELETE FROM BudgetRows WHERE VersionId=@VersionId');
        for (const r of rows) {
          await db.request()
            .input('VersionId', sql.Int, versionId)
            .input('Category', sql.NVarChar, r.category)
            .input('SubCategory', sql.NVarChar, r.subCategory)
            .input('Source', sql.NVarChar, r.source || null)
            .input('ImportedAt', sql.Date, r.importedAt || null)
            .input('Jan', sql.Int, r.Jan||0).input('Feb', sql.Int, r.Feb||0).input('Mar', sql.Int, r.Mar||0)
            .input('Apr', sql.Int, r.Apr||0).input('Maj', sql.Int, r.Maj||0).input('Jun', sql.Int, r.Jun||0)
            .input('Jul', sql.Int, r.Jul||0).input('Aug', sql.Int, r.Aug||0).input('Sep', sql.Int, r.Sep||0)
            .input('Okt', sql.Int, r.Okt||0).input('Nov', sql.Int, r.Nov||0).input('Dec', sql.Int, r.Dec||0)
            .query('INSERT INTO BudgetRows (VersionId,Category,SubCategory,Source,ImportedAt,Jan,Feb,Mar,Apr,Maj,Jun,Jul,Aug,Sep,Okt,Nov,Dec) VALUES (@VersionId,@Category,@SubCategory,@Source,@ImportedAt,@Jan,@Feb,@Mar,@Apr,@Maj,@Jun,@Jul,@Aug,@Sep,@Okt,@Nov,@Dec)');
        }
        return respond(context, 200, { message: 'Budget sparad' });
      }
    }

    if (path === 'riskSnapshot' && method === 'POST') {
      const b = req.body || {};
      if (!b.customerId) return respond(context, 400, { message: 'customerId krävs' });
      const r = calculateRiskScore(b);
      const ins = await insertRiskSnapshot(db, {
        customerId: b.customerId,
        triggerType: b.triggerType || 'manual',
        score: r.score, riskLevel: r.riskLevel, renewalProb: r.renewalProb, stepBase: r.stepBase,
        satisfaction: b.satisfaction || 0, activityLevel: b.activityLevel || '',
        economy: b.economy || 'unknown', focus: b.focus || 'unknown',
        daysToLicenseEnd: b.daysToLicenseEnd != null ? b.daysToLicenseEnd : null
      });
      const row = ins.recordset[0];
      return respond(context, 201, { id: row.Id, createdAt: row.CreatedAt, ...r });
    }

    if (path === 'renewalOutcome' && method === 'POST') {
      const b = req.body || {};
      if (!b.customerId || !b.outcome) return respond(context, 400, { message: 'customerId och outcome krävs' });
      const latest = await db.request()
        .input('CustomerId', sql.Int, b.customerId)
        .query('SELECT TOP 1 Id FROM RiskSnapshots WHERE CustomerId=@CustomerId ORDER BY CreatedAt DESC');
      const snapId = latest.recordset[0] ? latest.recordset[0].Id : null;
      const ins = await db.request()
        .input('CustomerId', sql.Int, b.customerId)
        .input('RiskSnapshotId', sql.Int, snapId)
        .input('Outcome', sql.NVarChar, b.outcome)
        .input('DecisionDate', sql.Date, b.decisionDate || null)
        .input('Notes', sql.NVarChar, b.notes || null)
        .input('Amount', sql.Int, b.amount != null ? b.amount : null)
        .query(`INSERT INTO RenewalOutcomes (CustomerId,RiskSnapshotId,Outcome,DecisionDate,Notes,Amount)
                OUTPUT INSERTED.Id
                VALUES (@CustomerId,@RiskSnapshotId,@Outcome,@DecisionDate,@Notes,@Amount)`);
      // Churnanledning i en egen feltålig UPDATE (kolumnen self-healas i
      // ensureSchemaColumns; bryter aldrig själva utfallssparningen om den saknas).
      const outId = ins.recordset && ins.recordset[0] ? ins.recordset[0].Id : null;
      if (outId && b.churnReason) {
        try {
          await db.request()
            .input('Id', sql.Int, outId)
            .input('ChurnReason', sql.NVarChar, b.churnReason)
            .query('UPDATE RenewalOutcomes SET ChurnReason=@ChurnReason WHERE Id=@Id');
        } catch (e) { /* kolumnen finns ännu inte */ }
      }
      return respond(context, 201, { message: 'Sparad', riskSnapshotId: snapId });
    }

    if (path === 'modelAnalysis' && method === 'GET') {
      const mode = (req.query && req.query.mode) || 'renewal';
      if (mode === 'pipeline') {
        const closed = (await db.request().query("SELECT * FROM Prospects WHERE Stage IN ('Closed Won','Closed Lost')")).recordset;
        const total = closed.length;
        const buckets = [[0, 20], [20, 40], [40, 60], [60, 80], [80, 100]];
        const calibration = buckets.map(([lo, hi]) => {
          const inB = closed.filter(p => (p.Probability || 0) >= lo && (p.Probability || 0) < (hi === 100 ? 101 : hi));
          const won = inB.filter(p => p.Stage === 'Closed Won').length;
          return { bucket: `${lo}-${hi}%`, predicted: (lo + hi) / 2, actual: inB.length ? Math.round(won / inB.length * 100) : null, n: inB.length };
        });
        const misclassified = closed.filter(p => {
          const prob = p.Probability || 0;
          return (prob > 60 && p.Stage === 'Closed Lost') || (prob < 40 && p.Stage === 'Closed Won');
        }).map(p => ({
          customerId: p.Id,
          company: p.Company,
          predictedLevel: (p.Probability || 0) >= 50 ? 'Hög' : 'Låg',
          predictedProb: p.Probability || 0,
          actualOutcome: p.Stage === 'Closed Won' ? 'Vunnen' : 'Förlorad',
          snapshotDate: p.CreatedAt,
          decisionDate: p.ClosedAt || p.UpdatedAt
        }));
        const catFactors = [
          { key: 'Industry', label: 'Bransch' },
          { key: 'Source', label: 'Källa' },
          { key: 'Owner', label: 'Kundansvarig' }
        ];
        const factorContribution = catFactors.map(f => {
          const groups = {};
          closed.forEach(p => {
            const v = p[f.key] || '–';
            if (!groups[v]) groups[v] = { won: 0, total: 0 };
            groups[v].total++;
            if (p.Stage === 'Closed Won') groups[v].won++;
          });
          const entries = Object.entries(groups).map(([v, s]) => ({ value: v, winRate: s.total ? Math.round(s.won / s.total * 100) : 0, n: s.total })).sort((a, b) => b.winRate - a.winRate);
          const rates = entries.map(e => e.winRate);
          const spread = rates.length ? Math.max(...rates) - Math.min(...rates) : 0;
          return { factor: f.label, key: f.key, entries, spread, predictiveLift: spread };
        });
        const empBuckets = [{ lo: 0, hi: 10, label: '1-10' }, { lo: 11, hi: 50, label: '11-50' }, { lo: 51, hi: 200, label: '51-200' }, { lo: 201, hi: 1000, label: '201-1000' }, { lo: 1001, hi: 1e9, label: '1000+' }];
        const empEntries = empBuckets.map(b => {
          const inB = closed.filter(p => (p.Employees || 0) >= b.lo && (p.Employees || 0) <= b.hi);
          const won = inB.filter(p => p.Stage === 'Closed Won').length;
          return { value: b.label, winRate: inB.length ? Math.round(won / inB.length * 100) : 0, n: inB.length };
        }).filter(e => e.n > 0);
        const empRates = empEntries.map(e => e.winRate);
        const empSpread = empRates.length ? Math.max(...empRates) - Math.min(...empRates) : 0;
        factorContribution.push({ factor: 'Storlek (anställda)', key: 'Employees', entries: empEntries, spread: empSpread, predictiveLift: empSpread });
        factorContribution.sort((a, b) => b.spread - a.spread);
        let suggestedWeights = null;
        if (total >= 20) {
          const maxSpread = Math.max(...factorContribution.map(f => f.spread), 1);
          suggestedWeights = {};
          factorContribution.forEach(f => {
            suggestedWeights[f.key] = Math.round(Math.max(0.5, Math.min(2, f.spread / maxSpread * 1.5)) * 100) / 100;
          });
        }
        return respond(context, 200, {
          mode: 'pipeline',
          totalSnapshots: total, totalOutcomes: total, pairedCount: total,
          calibration, misclassified, confusionMatrix: {}, factorContribution,
          weightsLocked: total < 20, suggestedWeights, outcomesNeeded: Math.max(0, 20 - total)
        });
      }
      const snaps = (await db.request().query('SELECT * FROM RiskSnapshots ORDER BY CreatedAt DESC')).recordset;
      const outs = (await db.request().query('SELECT * FROM RenewalOutcomes ORDER BY CreatedAt DESC')).recordset;
      const snapById = {}; snaps.forEach(s => { snapById[s.Id] = s; });
      const paired = outs.map(o => {
        let snap = o.RiskSnapshotId ? snapById[o.RiskSnapshotId] : null;
        if (!snap) {
          const cand = snaps.filter(s => s.CustomerId === o.CustomerId && new Date(s.CreatedAt) <= new Date(o.CreatedAt));
          snap = cand[0] || null;
        }
        return { outcome: o, snapshot: snap };
      }).filter(p => p.snapshot);
      const buckets = [[0, 20], [20, 40], [40, 60], [60, 80], [80, 100]];
      const calibration = buckets.map(([lo, hi]) => {
        const inB = paired.filter(p => p.snapshot.RenewalProb >= lo && p.snapshot.RenewalProb < (hi === 100 ? 101 : hi));
        const renewed = inB.filter(p => p.outcome.Outcome === 'Förnyade').length;
        const total = inB.length;
        return { bucket: `${lo}-${hi}%`, predicted: (lo + hi) / 2, actual: total ? Math.round(renewed / total * 100) : null, n: total };
      });
      const misclassified = paired.filter(p => {
        const pred = p.snapshot.RiskLevel;
        const out = p.outcome.Outcome;
        return (pred === 'Hög' && out === 'Förnyade') || (pred === 'Låg' && out === 'Churnade');
      }).map(p => ({
        customerId: p.outcome.CustomerId,
        snapshotDate: p.snapshot.CreatedAt,
        predictedLevel: p.snapshot.RiskLevel,
        predictedProb: p.snapshot.RenewalProb,
        actualOutcome: p.outcome.Outcome,
        decisionDate: p.outcome.DecisionDate
      }));
      const levels = ['Hög', 'Medium', 'Låg'];
      const outcomes = ['Förnyade', 'Churnade', 'Pausad', 'Ej registrerat'];
      const matrix = {};
      levels.forEach(l => { matrix[l] = {}; outcomes.forEach(o => matrix[l][o] = 0); });
      paired.forEach(p => { if (matrix[p.snapshot.RiskLevel]) matrix[p.snapshot.RiskLevel][p.outcome.Outcome] = (matrix[p.snapshot.RiskLevel][p.outcome.Outcome] || 0) + 1; });
      const factorKeys = ['StepBase', 'Satisfaction', 'ActivityLevel', 'Economy', 'Focus'];
      const factorScore = (snap, key) => {
        if (key === 'StepBase') return snap.StepBase || 0;
        if (key === 'Satisfaction') return ({ 1: -100, 2: -75, 3: -25, 4: 0, 5: 25 })[snap.Satisfaction] || 0;
        if (key === 'ActivityLevel') { const m = { '': -50, 'ingen': -50, 'Låg': -25, 'låg': -25, 'Medium': 25, 'medium': 25, 'Hög': 50, 'hög': 50 }; return m[snap.ActivityLevel] != null ? m[snap.ActivityLevel] : 0; }
        if (key === 'Economy') { const m = { large_savings: -50, savings: -25, unknown: 0, good: 25 }; return m[snap.Economy] != null ? m[snap.Economy] : 0; }
        if (key === 'Focus') { const m = { strong_other: -50, other: -25, unknown: 0, priority: 25 }; return m[snap.Focus] != null ? m[snap.Focus] : 0; }
        return 0;
      };
      const factorContribution = factorKeys.map(k => {
        const renewed = paired.filter(p => p.outcome.Outcome === 'Förnyade').map(p => factorScore(p.snapshot, k));
        const churned = paired.filter(p => p.outcome.Outcome === 'Churnade').map(p => factorScore(p.snapshot, k));
        const avg = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
        const lift = avg(renewed) - avg(churned);
        return { factor: k, avgRenewed: Math.round(avg(renewed) * 10) / 10, avgChurned: Math.round(avg(churned) * 10) / 10, predictiveLift: Math.round(lift * 10) / 10 };
      }).sort((a, b) => Math.abs(b.predictiveLift) - Math.abs(a.predictiveLift));
      const totalOutcomes = outs.length;
      let suggestedWeights = null;
      if (totalOutcomes >= 20) {
        const maxLift = Math.max(...factorContribution.map(f => Math.abs(f.predictiveLift)), 1);
        suggestedWeights = {};
        factorContribution.forEach(f => {
          const scale = Math.max(0.5, Math.min(2, Math.abs(f.predictiveLift) / maxLift * 1.5));
          suggestedWeights[f.factor] = Math.round(scale * 100) / 100;
        });
      }
      return respond(context, 200, {
        totalSnapshots: snaps.length, totalOutcomes, pairedCount: paired.length,
        calibration, misclassified, confusionMatrix: matrix, factorContribution,
        weightsLocked: totalOutcomes < 20, suggestedWeights, outcomesNeeded: Math.max(0, 20 - totalOutcomes)
      });
    }

    return respond(context, 404, { message: 'Endpoint hittades inte' });

  } catch (err) {
    return respond(context, 500, { message: 'Serverfel', error: err.message });
  }
};

function respond(context, status, body) {
  context.res = {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  };
}