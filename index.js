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

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.get('/clients', async (req, res) => {
  const { data, error } = await supabase.from('clients').select('*');
  if (error) return res.status(400).json({ error });
  res.json(data);
});

app.get('/accounts/:clientId', async (req, res) => {
  const { data, error } = await supabase
    .from('ad_accounts').select('*')
    .eq('client_id', req.params.clientId);
  if (error) return res.status(400).json({ error });
  res.json(data);
});

app.get('/metrics/:accountId', async (req, res) => {
  const period = req.query.period || '30d';
  const periodMap = { '7d': 7, '30d': 30, '90d': 90 };
  const days = periodMap[period] || 30;
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceStr = since.toISOString().split('T')[0];
  const nowStr = new Date().toISOString().split('T')[0];

  try {
    const { data: account } = await supabase
      .from('ad_accounts').select('*')
      .eq('id', req.params.accountId).single();

    // Métricas gerais
    const metaRes = await axios.get(
      `https://graph.facebook.com/v19.0/${account.account_id}/insights`,
      { params: {
        access_token: account.access_token,
        time_range: JSON.stringify({ since: sinceStr, until: nowStr }),
        fields: 'impressions,clicks,spend,reach,ctr,cpm,actions',
        level: 'account',
      }}
    );

    const raw = metaRes.data.data[0] || {};
    const actions = raw.actions || [];
    const conversions = actions.find(a => a.action_type === 'purchase' || a.action_type === 'lead');
    const conversations = actions.find(a => 
      a.action_type === 'onsite_conversion.messaging_conversation_started_7d' ||
      a.action_type === 'onsite_conversion.total_messaging_connection' ||
      a.action_type === 'onsite_conversion.messaging_first_reply'
    );

    // Gasto diário
    const dailyRes = await axios.get(
      `https://graph.facebook.com/v19.0/${account.account_id}/insights`,
      { params: {
        access_token: account.access_token,
        time_range: JSON.stringify({ since: sinceStr, until: nowStr }),
        fields: 'spend,impressions,clicks',
        time_increment: 1,
        level: 'account',
      }}
    );
    const daily = (dailyRes.data.data || []).map(d => ({
      date: d.date_start,
      spend: parseFloat(d.spend || 0),
      impressions: parseInt(d.impressions || 0),
      clicks: parseInt(d.clicks || 0),
    }));

    // Campanhas ativas
    const campRes = await axios.get(
      `https://graph.facebook.com/v19.0/${account.account_id}/campaigns`,
      { params: {
        access_token: account.access_token,
        fields: 'id,name,status,objective',


        effective_status: ['ACTIVE','PAUSED','ARCHIVED','DELETED','CAMPAIGN_PAUSED'],
        limit: 20,
        limit: 20,
      }}
    );
    const campaigns = campRes.data.data || [];const campaigns = (campRes.data.data || []).filter(c => c.status === 'ACTIVE' || c.effective_status === 'ACTIVE');

    res.json({
      spend: parseFloat(raw.spend || 0).toFixed(2),
      impressions: parseInt(raw.impressions || 0),
      clicks: parseInt(raw.clicks || 0),
      reach: parseInt(raw.reach || 0),
      ctr: parseFloat(raw.ctr || 0).toFixed(2),
      cpm: parseFloat(raw.cpm || 0).toFixed(2),
      conversions: conversions ? parseInt(conversions.value) : 0,
      conversations: conversations ? parseInt(conversations.value) : 0,
      daily,
      campaigns,
    });
  } catch (err) {
    console.error(err?.response?.data || err.message);
    res.status(500).json({ error: 'Erro ao buscar métricas na Meta' });
  }
});

// Métricas de uma campanha específica
app.get('/campaign/:campaignId', async (req, res) => {
  const { accountId, period } = req.query;
  const periodMap = { '7d': 7, '30d': 30, '90d': 90 };
  const days = periodMap[period] || 30;
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceStr = since.toISOString().split('T')[0];
  const nowStr = new Date().toISOString().split('T')[0];

  try {
    const { data: account } = await supabase
      .from('ad_accounts').select('*')
      .eq('id', accountId).single();

    const res2 = await axios.get(
      `https://graph.facebook.com/v19.0/${req.params.campaignId}/insights`,
      { params: {
        access_token: account.access_token,
        time_range: JSON.stringify({ since: sinceStr, until: nowStr }),
        fields: 'impressions,clicks,spend,reach,ctr,cpm,actions,frequency',
        level: 'campaign',
      }}
    );

    const raw = res2.data.data[0] || {};
    const actions = raw.actions || [];
    const conversations = actions.find(a =>
      a.action_type === 'onsite_conversion.messaging_conversation_started_7d' ||
      a.action_type === 'onsite_conversion.total_messaging_connection' ||
      a.action_type === 'onsite_conversion.messaging_first_reply'
    );

    res.json({
      spend: parseFloat(raw.spend || 0).toFixed(2),
      impressions: parseInt(raw.impressions || 0),
      clicks: parseInt(raw.clicks || 0),
      reach: parseInt(raw.reach || 0),
      ctr: parseFloat(raw.ctr || 0).toFixed(2),
      cpm: parseFloat(raw.cpm || 0).toFixed(2),
      frequency: parseFloat(raw.frequency || 0).toFixed(2),
      conversations: conversations ? parseInt(conversations.value) : 0,
      actions,
    });
  } catch (err) {
    console.error(err?.response?.data || err.message);
    res.status(500).json({ error: 'Erro ao buscar métricas da campanha' });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`API rodando na porta ${PORT}`));
