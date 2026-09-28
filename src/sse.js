// src/sse.js - Real-time Server-Sent Events (SSE) Engine
// Broadcasts live audit logs, new AE reports, and KPI changes to all connected dashboards.

const clients = new Set();

function registerClient(req, res) {
  // Set SSE response headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });

  res.write('event: connected\ndata: {"status":"connected","timestamp":"' + new Date().toISOString() + '"}\n\n');

  const client = { id: Date.now() + Math.random(), res };
  clients.add(client);

  console.log(`[SSE] Client connected (${client.id}). Total connected: ${clients.size}`);

  // Heartbeat to prevent timeouts
  const heartbeatTimer = setInterval(() => {
    try {
      res.write(': heartbeat\n\n');
    } catch (e) {
      clearInterval(heartbeatTimer);
      clients.delete(client);
    }
  }, 25000);

  req.on('close', () => {
    clearInterval(heartbeatTimer);
    clients.delete(client);
    console.log(`[SSE] Client disconnected (${client.id}). Remaining: ${clients.size}`);
  });
}

function broadcast(eventType, data) {
  const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    try {
      client.res.write(payload);
    } catch (err) {
      clients.delete(client);
    }
  }
}

// Global hook for db and server
global.trialsetuSseBroadcast = broadcast;

module.exports = {
  registerClient,
  broadcast
};
