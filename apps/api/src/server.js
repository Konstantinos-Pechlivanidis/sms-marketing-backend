const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const pino = require('pino');
const healthRoutes = require('./routes/health');

const logger = pino({ transport: { target: 'pino-pretty' } });
const app = express();

// CORS allowlist από env (comma separated)
const allowlist = (process.env.CORS_ALLOWLIST || '').split(',').map(s => s.trim()).filter(Boolean);
const corsOptions = allowlist.length
  ? {
      origin(origin, cb) {
        if (!origin) return cb(null, true);                 // tools/health checks
        const ok = allowlist.some(a => origin.startsWith(a));
        cb(ok ? null : new Error('Not allowed by CORS'), ok);
      },
      credentials: true,
    }
  : { origin: true, credentials: true };

app.use(helmet());
app.use(cors(corsOptions));

// keep a raw copy for HMAC verification
app.use(express.json({
  verify: (req, res, buf) => { req.rawBody = buf; }
}));

// routes
app.use(healthRoutes);

// default
app.get('/', (_req, res) => res.json({ status: 'api-ok' }));

const cookieParser = require('cookie-parser');
const authRoutes = require('./routes/auth');
const requireAuth = require('./middleware/requireAuth');
app.use(cookieParser());
app.use(authRoutes);
app.get('/me', requireAuth, (req,res)=> res.json({ user: req.user }));

const contactsRoutes = require('./routes/contacts');
const listsRoutes = require('./routes/lists');
app.use(contactsRoutes);
app.use(listsRoutes);

const templatesRoutes = require('./routes/templates');
const campaignsRoutes = require('./routes/campaigns');
app.use(templatesRoutes);
app.use(campaignsRoutes);

const mittoRoutes = require('./routes/mitto');
app.use(mittoRoutes);

const mittoWebhookRoutes = require('./routes/mitto.webhooks');
app.use(mittoWebhookRoutes);

const jobsRoutes = require('./routes/jobs');
app.use(jobsRoutes);

const trackingRoutes = require('./routes/tracking');
app.use('/tracking', trackingRoutes);

const campaignStatsRoutes = require('./routes/campaigns.stats');
app.use('/api/v1', campaignStatsRoutes);

const campaignsListRoutes = require('./routes/campaigns.list');
app.use('/api/v1', campaignsListRoutes);

const port = process.env.PORT || 3001;
app.listen(port, () => logger.info(`API running on http://localhost:${port}`));


