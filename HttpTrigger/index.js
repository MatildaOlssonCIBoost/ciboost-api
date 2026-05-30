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

module.exports = async function (context, req) {
  const method = req.method.toUpperCase();
  const path = req.params.path || '';

  if (method === 'OPTIONS') {
    context.res = { status: 204, headers: corsHeaders, body: '' };
    return;
  }

  try {
    const db = await getPool();

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
                  VALUES (@Company,@Industry,@Contact,@Role,@Source,@Owner,@Stage,@Score,@Value,@Probability,@LastContact,@NextMeeting,@Notes)`);
        return respond(context, 201, { message: 'Skapad' });
      }
    }

    if (path.startsWith('prospects/')) {
      const id = path.split('/')[1];
      if (method === 'PUT') {
        const p = req.body;
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
          .input('ValueMin', sql.Int, p.valueMin || null)
          .input('ValueMax', sql.Int, p.valueMax || null)
          .input('LostReason', sql.NVarChar, p.lostReason || null)
          .query(`UPDATE Prospects SET Company=@Company,Industry=@Industry,Contact=@Contact,Role=@Role,
        Source=@Source,Owner=@Owner,Stage=@Stage,Score=@Score,Value=@Value,Probability=@Probability,
        LastContact=@LastContact,NextMeeting=@NextMeeting,Notes=@Notes,
        ValueMin=@ValueMin,ValueMax=@ValueMax,LostReason=@LostReason,UpdatedAt=GETDATE() WHERE Id=@Id`);
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
          .query(`INSERT INTO Customers (Company,Contact,Owner,SubName,LicenseType,LicenseStart,LicenseEnd,ARR,ARR_Fixed,Revenue_Training,Revenue_Training_Date,Revenue_Consulting,Revenue_Consulting_Date,Risk,Notes)
                  VALUES (@Company,@Contact,@Owner,@SubName,@LicenseType,@LicenseStart,@LicenseEnd,@ARR,@ARR_Fixed,@Revenue_Training,@Revenue_Training_Date,@Revenue_Consulting,@Revenue_Consulting_Date,@Risk,@Notes)`);
        return respond(context, 201, { message: 'Kund skapad' });
      }
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
          .query('INSERT INTO BudgetVersions (Name,Year,CreatedBy) VALUES (@Name,@Year,@CreatedBy)');
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
          .query('UPDATE BudgetVersions SET Name=@Name, Year=@Year WHERE Id=@Id');
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
            .input('Jan', sql.Int, r.Jan||0).input('Feb', sql.Int, r.Feb||0).input('Mar', sql.Int, r.Mar||0)
            .input('Apr', sql.Int, r.Apr||0).input('Maj', sql.Int, r.Maj||0).input('Jun', sql.Int, r.Jun||0)
            .input('Jul', sql.Int, r.Jul||0).input('Aug', sql.Int, r.Aug||0).input('Sep', sql.Int, r.Sep||0)
            .input('Okt', sql.Int, r.Okt||0).input('Nov', sql.Int, r.Nov||0).input('Dec', sql.Int, r.Dec||0)
            .query('INSERT INTO BudgetRows (VersionId,Category,SubCategory,Jan,Feb,Mar,Apr,Maj,Jun,Jul,Aug,Sep,Okt,Nov,Dec) VALUES (@VersionId,@Category,@SubCategory,@Jan,@Feb,@Mar,@Apr,@Maj,@Jun,@Jul,@Aug,@Sep,@Okt,@Nov,@Dec)');
        }
        return respond(context, 200, { message: 'Budget sparad' });
      }
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