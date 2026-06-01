require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Lista contas do cliente
app.get('/accounts/:clientId', async (req, res) => {
  const { clientId } = req.params;
  const { data, error } = await supabase
    .from('ad_accounts')
    .select('*')
    .eq('client_id', clientId);
  if (error) return res.status(400).json({ error });
  res.json(data);
});

// Métricas de uma conta
app.get('/metrics/:accountId', async (req, res) => {
  const { accountId } = req.params;
  const period = req.query.period || '30d';

  const periodMap = { '7d': 7, '30d': 30, '90d': 90 };
  const days = periodMap[period] || 30;

  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceStr = since.toISOString().split('T')[0];
  const nowStr = new Date().toISOString().split('T')[0];

  try {
    const { data: account, error } = await supabase
      .from('ad_accounts')
      .select('*')
      .eq('id', accountId)
      .single();

    if (error) return res.status(404).json({ error: 'Conta não encontrada' });

    const metaRes = await axios.get(
      `https://graph.facebook.com/v19.0/${account.account_id}/insights`,
      {
        params: {
          access_token: account.access_token,
          time_range: JSON.stringify({ since: sinceStr, until: nowStr }),
          fields: 'impressions,clicks,spend,reach,ctr,cpm,actions',
          level: 'account',
        }
      }
    );

    const raw = metaRes.data.data[0] || {};
    const conversions = (raw.actions || []).find(
      a => a.action_type === 'purchase' || a.action_type === 'lead'
    );

    const metrics = {
      spend: parseFloat(raw.spend || 0).toFixed(2),
      impressions: parseInt(raw.impressions || 0),
      clicks: parseInt(raw.clicks || 0),
      reach: parseInt(raw.reach || 0),
      ctr: parseFloat(raw.ctr || 0).toFixed(2),
      cpm: parseFloat(raw.cpm || 0).toFixed(2),
      conversions: conversions ? parseInt(conversions.value) : 0,
    };

    res.json(metrics);
  } catch (err) {
    console.error(err?.response?.data || err.message);
    res.status(500).json({ error: 'Erro ao buscar métricas na Meta' });
  }
});

// Lista clientes
app.get('/clients', async (req, res) => {
  const { data, error } = await supabase.from('clients').select('*');
  if (error) return res.status(400).json({ error });
  res.json(data);
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`API rodando na porta ${PORT}`));
