export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { type, ...body } = req.body;

  // Handle Supabase queries
  if (type === 'supabase_query') {
    const { table, search } = body;
    const searchCol = table === "color" ? "Property" : table === "axes" ? "Summary" : "Name";
    const url = `${process.env.SUPABASE_URL}/rest/v1/${table}?${searchCol}=ilike.*${encodeURIComponent(search)}*&limit=10`;
    const r = await fetch(url, {
      headers: {
        apikey: process.env.SUPABASE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_KEY}`,
      },
    });
    const data = await r.json();
    return res.status(200).json(data);
  }

  // Handle Supabase inserts
  if (type === 'supabase_insert') {
    const { table, row } = body;
    const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${table}`, {
      method: 'POST',
      headers: {
        apikey: process.env.SUPABASE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(row),
    });
    return res.status(r.ok ? 200 : 500).json({ ok: r.ok });
  }

  // Handle Claude API calls
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
