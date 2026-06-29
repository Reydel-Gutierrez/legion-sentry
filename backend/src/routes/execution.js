const express = require('express');
const fieldExecutionEngine = require('../services/execution/fieldExecutionEngine');
const pointPollingEngine = require('../services/execution/pointPollingEngine');
const logsService = require('../services/logs');

const router = express.Router();

router.get('/status', (_req, res) => {
  res.json(fieldExecutionEngine.getExecutionStatus());
});

router.get('/jobs', (req, res) => {
  const filters = {};
  if (req.query.status) filters.status = req.query.status;
  if (req.query.type) filters.type = req.query.type;
  if (req.query.managedDeviceId) filters.managedDeviceId = req.query.managedDeviceId;
  res.json({ jobs: fieldExecutionEngine.getJobs(filters) });
});

router.get('/jobs/:id', (req, res) => {
  const job = fieldExecutionEngine.getJobById(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

router.post('/jobs', (req, res, next) => {
  try {
    const payload = req.body || {};
    const job = fieldExecutionEngine.createJob(payload);
    logsService.addLog({
      level: 'info',
      service: 'bacnet',
      message: `Execution job created — ${job.type} (${job.id})`,
    });
    res.status(201).json(job);
  } catch (err) {
    next(err);
  }
});

router.post('/jobs/:id/cancel', (req, res) => {
  const job = fieldExecutionEngine.cancelJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  logsService.addLog({
    level: 'info',
    service: 'bacnet',
    message: `Execution job cancel requested — ${job.id} (${job.status})`,
  });
  res.json(job);
});

router.post('/jobs/clear-completed', (_req, res) => {
  const result = fieldExecutionEngine.clearCompletedJobs();
  res.json({ success: true, ...result });
});

router.post('/jobs/clear-failed', (_req, res) => {
  const result = fieldExecutionEngine.clearFailedJobs();
  logsService.addLog({
    level: 'info',
    service: 'bacnet',
    message: `Cleared ${result.removed} failed execution job(s)`,
  });
  res.json({ success: true, ...result });
});

router.post('/jobs/cancel-queued', (_req, res) => {
  const result = fieldExecutionEngine.cancelQueuedJobs();
  logsService.addLog({
    level: 'info',
    service: 'bacnet',
    message: `Cancelled ${result.cancelled} queued execution job(s)`,
  });
  res.json({ success: true, ...result });
});

router.post('/jobs/cancel-queued-polling', (_req, res) => {
  const result = fieldExecutionEngine.cancelQueuedPollingJobs();
  logsService.addLog({
    level: 'info',
    service: 'bacnet',
    message: `Cancelled ${result.cancelled} queued polling job(s)`,
  });
  res.json({ success: true, ...result });
});

router.post('/polling/pause', (_req, res) => {
  pointPollingEngine.pause();
  logsService.addLog({ level: 'info', service: 'bacnet', message: 'Point polling paused by user' });
  res.json({ success: true, polling: pointPollingEngine.getStatus() });
});

router.post('/polling/resume', (_req, res) => {
  pointPollingEngine.resume();
  logsService.addLog({ level: 'info', service: 'bacnet', message: 'Point polling resumed by user' });
  res.json({ success: true, polling: pointPollingEngine.getStatus() });
});

module.exports = router;
