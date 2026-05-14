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

    // Prospects
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
          .query(`UPDATE Prospects SET Company=@Company,Industry=@Industry,Contact=@Contact,Role=@Role,
                  Source=@Source,Owner=@Owner,Stage=@Stage,Score=@Score,Value=@Value,Probability=@Probability,
                  LastContact=@LastContact,NextMeeting=@NextMeeting,Notes=@Notes,UpdatedAt=GETDATE() WHERE Id=@Id`);
        return respond(context, 200, { message: 'Uppdaterad' });
      }
      if (method === 'DELETE') {
        await db.request().input('Id', sql.Int, id)
          .query('DELETE FROM Activities WHERE ProspectId=@Id; DELETE FROM Prospects WHERE Id=@Id');
        return respond(context, 200, { message: 'Borttagen' });
      }
    }

    // Customer Teams - FÖRE customers/ PUT
    if (path.startsWith('customers/') && path.includes('/teams')) {
      const customerId = path.split('/')[1];
      if (method === 'GET') {
        const result = await db.request()
          .input('CustomerId', sql.Int, customerId)
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
        await db.request()
          .input('CustomerId', sql.Int, customerId)
          .query('DELETE FROM CustomerTeams WHERE CustomerId=@CustomerId');
        return respond(context, 200, { message: 'Teams borttagna' });
      }
    }

    // Customer Admins - FÖRE customers/ PUT
    if (path.startsWith('customers/') && path.includes('/admins')) {
      const customerId = path.split('/')[1];
      if (method === 'GET') {
        const result = await db.request()
          .input('CustomerId', sql.Int, customerId)
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
        await db.request()
          .input('CustomerId', sql.Int, customerId)
          .query('DELETE FROM CustomerAdmins WHERE CustomerId=@CustomerId');
        return respond(context, 200, { message: 'Admins borttagna' });
      }
    }

    // Customer Activities - FÖRE customers/ PUT
    if (path.startsWith('activities/customer/')) {
      const customerId = path.split('/')[2];
      if (method === 'GET') {
        const result = await db.request()
          .input('CustomerId', sql.Int, customerId)
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

    // Customer PUT
    if (path.startsWith('customers/') && !path.includes('/teams') && !path.includes('/admins')) {
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
          .input('Revenue_Consulting', sql.Int, c.revenueConsulting)
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
          .query(`UPDATE Customers SET 
             Company=@Company, SubName=@SubName, Contact=@Contact, ContactRole=@ContactRole,
            ContactEmail=@ContactEmail, ContactPhone=@ContactPhone,
            CustomerSince=@CustomerSince, LicenseType=@LicenseType,
            LicenseStart=@LicenseStart, LicenseEnd=@LicenseEnd,
            ARR=@ARR, ARR_Fixed=@ARR_Fixed, Revenue_Training=@Revenue_Training,
            Revenue_Consulting=@Revenue_Consulting, Risk=@Risk,
            TeamName=@TeamName, MeetingLeader1=@MeetingLeader1,
            MeetingLeader1Email=@MeetingLeader1Email, MeetingLeader1Phone=@MeetingLeader1Phone,
            MeetingLeader2=@MeetingLeader2, MeetingLeader2Email=@MeetingLeader2Email,
            MeetingLeader2Phone=@MeetingLeader2Phone,
            CommissionSalesperson=@CommissionSalesperson, CommissionPercent=@CommissionPercent,
            CommissionAmount=@CommissionAmount, Notes=@Notes
            WHERE Id=@Id`);
        return respond(context, 200, { message: 'Uppdaterad' });
      }
    }

    // Customers GET/POST
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
          .input('Source', sql.NVarChar, c.source)
          .input('LicenseType', sql.NVarChar, c.licenseType)
          .input('LicenseStart', sql.Date, c.licenseStart || null)
          .input('LicenseEnd', sql.Date, c.licenseEnd || null)
          .input('ARR', sql.Int, c.arr)
          .input('Risk', sql.NVarChar, c.risk)
          .input('Notes', sql.NVarChar, c.notes)
          .query(`INSERT INTO Customers (Company,Contact,Source,LicenseType,LicenseStart,LicenseEnd,ARR,Risk,Notes)
                  VALUES (@Company,@Contact,@Source,@LicenseType,@LicenseStart,@LicenseEnd,@ARR,@Risk,@Notes)`);
        return respond(context, 201, { message: 'Kund skapad' });
      }
    }

    // Prospect Activities
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

    return respond(context, 404, { message: 'Endpoint hittades inte' });

  } catch (err) {
    return respond(context, 500, { message: 'Serverfel', error: err.message });
  }
};

function respond(context, status, body) {
  context.res = {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  };
}