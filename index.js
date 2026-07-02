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
        fields: 'id,name,status,effective_status,objective,stop_time',


        effective_status: ['ACTIVE','PAUSED','ARCHIVED','WITH_ISSUES','CAMPAIGN_PAUSED'],
        limit: account.account_id === 'act_725071917282682' ? 200 : 20,
        limit: account.account_id === 'act_725071917282682' ? 200 : 20,
      }}
    );
    const campaigns = campRes.data.data || [];

    // Busca status da conta
    const statusRes = await axios.get(
      `https://graph.facebook.com/v19.0/${account.account_id}`,
      { params: { access_token: account.access_token, fields: 'account_status,disable_reason' }}
    ).catch(() => ({ data: { account_status: 1 } }));

    const accountStatus = statusRes.data.account_status;
    const disableReason = statusRes.data.disable_reason || 0;

    res.json({
      accountStatus,
      disableReason,
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
    console.error(JSON.stringify(err?.response?.data || err.message));
    res.status(500).json({ error: 'Erro ao buscar métricas na Meta', detail: err?.response?.data || err.message });
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

// Lista todas as campanhas de uma conta, sem filtro de status
app.get('/campaigns/:accountId', async (req, res) => {
  try {
    const { data: account } = await supabase
      .from('ad_accounts').select('*')
      .eq('id', req.params.accountId).single();
    if (!account) return res.status(404).json({ error: 'Conta não encontrada' });

    const campRes = await axios.get(
      `https://graph.facebook.com/v19.0/${account.account_id}/campaigns`,
      { params: {
        access_token: account.access_token,
        fields: 'id,name,status,effective_status',
        limit: 500,
      }}
    );
    res.json(campRes.data.data || []);
  } catch (err) {
    console.error(err?.response?.data || err.message);
    res.status(500).json({ error: 'Erro ao buscar campanhas' });
  }
});

// Métricas de gasto de uma lista de campanhas em um intervalo de datas específico
app.post('/metrics-campaigns-date', async (req, res) => {
  const { campaignIds, accountId, since, until } = req.body || {};
  if (!Array.isArray(campaignIds) || !campaignIds.length || !accountId || !since || !until) {
    return res.status(400).json({ error: 'campaignIds, accountId, since e until são obrigatórios' });
  }
  try {
    const { data: account } = await supabase
      .from('ad_accounts').select('*')
      .eq('id', accountId).single();
    if (!account) return res.status(404).json({ error: 'Conta não encontrada' });

    const results = [];
    const chunkSize = 50;
    for (let i = 0; i < campaignIds.length; i += chunkSize) {
      const chunk = campaignIds.slice(i, i + chunkSize);
      const insightsRes = await axios.get(
        `https://graph.facebook.com/v19.0/${account.account_id}/insights`,
        { params: {
          access_token: account.access_token,
          time_range: JSON.stringify({ since, until }),
          level: 'campaign',
          fields: 'campaign_id,spend,impressions,clicks,reach',
          filtering: JSON.stringify([{ field: 'campaign.id', operator: 'IN', value: chunk }]),
          limit: 500,
        }}
      );
      (insightsRes.data.data || []).forEach(r => {
        results.push({
          campaignId: r.campaign_id,
          spend: parseFloat(r.spend || 0),
          impressions: parseInt(r.impressions || 0),
          clicks: parseInt(r.clicks || 0),
          reach: parseInt(r.reach || 0),
        });
      });
    }

    res.json({ results });
  } catch (err) {
    console.error(err?.response?.data || err.message);
    res.status(500).json({ error: 'Erro ao buscar métricas das campanhas', detail: err?.response?.data || err.message });
  }
});

// Renova tokens automaticamente
async function renewTokens() {
  try {
    const { data: accounts, error } = await supabase.from('ad_accounts').select('*');
    if (error || !accounts) { console.error('Erro ao buscar contas:', error); return; }
    for (const acc of accounts) {
      try {
        const res = await axios.get('https://graph.facebook.com/v19.0/oauth/access_token', {
          params: {
            grant_type: 'fb_exchange_token',
            client_id: '1359788582689921',
            client_secret: 'bc3047a58d493fe264de69c129e8eedf',
            fb_exchange_token: acc.access_token,
          }
        });
        const newToken = res.data.access_token;
        await supabase.from('ad_accounts').update({ access_token: newToken }).eq('id', acc.id);
        console.log(`Token renovado para: ${acc.account_name}`);
      } catch (err) {
        console.error(`Erro ao renovar token de ${acc.account_name}:`, err?.response?.data || err.message);
      }
    }
  } catch (err) {
    console.error('Erro ao buscar contas para renovar tokens:', err.message);
  }
}

// Roda na inicialização e todo dia às 3h da manhã
renewTokens();
const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
setInterval(renewTokens, TWENTY_FOUR_HOURS);

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`API rodando na porta ${PORT}`));
