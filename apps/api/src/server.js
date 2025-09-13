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
app.use(express.json());

// routes
app.use(healthRoutes);

// default
app.get('/', (_req, res) => res.json({ status: 'api-ok' }));

const port = process.env.PORT || 3001;
app.listen(port, () => logger.info(`API running on http://localhost:${port}`));
