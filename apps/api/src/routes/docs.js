// apps/api/src/routes/docs.js
const express = require('express');
const swaggerUi = require('swagger-ui-express');
const YAML = require('yamljs');
const path = require('path');

const router = express.Router();

const specPath = path.join(__dirname, '..', 'docs', 'openapi.yaml');
const openapiDocument = YAML.load(specPath);

// Serve JSON spec
router.get('/openapi.json', (_req, res) => res.json(openapiDocument));

// Swagger UI (served under /docs)
router.use('/docs', swaggerUi.serve, swaggerUi.setup(openapiDocument, {
  explorer: true,
  customSiteTitle: 'SMS Blossom API Docs',
}));

module.exports = router;
