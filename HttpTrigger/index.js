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

    if (path.startsWith('customers/')) {
      const id = path.split('/')[1];
      if (method === 'PUT') {
        const c = req.body;
        await db.request()
          .input('Id', sql.Int, id)
          .input('Company', sql.NVarChar, c.company)
          .input('Contact', sql.NVarChar, c.contact)
          .input('Owner', sql.NVarChar, c.owner)
          .input('LicenseType', sql.NVarChar, c.licenseType)
          .input('LicenseStart', sql.Date, c.licenseStart || null)
          .input('LicenseEnd', sql.Date, c.licenseEnd || null)
          .input('ARR', sql.Int, c.arr)
          .input('Risk', sql.NVarChar, c.risk)
          .input('Notes', sql.NVarChar, c.notes)
          .query('UPDATE Customers SET Company=@Company,Contact=@Contact,Owner=@Owner,LicenseType=@LicenseType,LicenseStart=@LicenseStart,LicenseEnd=@LicenseEnd,ARR=@ARR,Risk=@Risk,Notes=@Notes WHERE Id=@Id');
        return respond(context, 200, { message: 'Uppdaterad' });
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