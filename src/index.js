const express = require("express");
const http = require("http");
const { WebSocketServer } = require("ws");
const OCPP = require("./ocppCentral");

const app = express();
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });
const central = new OCPP();

server.on("upgrade", (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, (ws) => {
    central.registerConnection(ws, req);
  });
});

// HTTP endpoints para administración
app.get("/", (req, res) =>
  res.json({ 
    message: "Servidor OCPP activo", 
    endpoints: {
      health: "/health",
      chargepoints: "/chargepoints",
      remoteStart: "/remoteStart (POST)",
      broadcast: "/broadcast (POST)"
    },
    websocket: "ws://localhost:3000/{chargePointId}"
  })
);

app.get("/health", (req, res) =>
  res.json({ status: "ok", connected: central.countChargePoints() })
);
app.get("/chargepoints", (req, res) => res.json(central.listChargePoints()));

app.post("/remoteStart", async (req, res) => {
  const { cpId, connectorId, idTag } = req.body;
  try {
    const result = await central.sendRemoteStart(cpId, connectorId, idTag);
    res.json({ cpId, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/broadcast", async (req, res) => {
  const { action, payload } = req.body;
  const results = await central.broadcast(action, payload);
  res.json({ sent: results.length, results });
});

const PORT_HTTP = 3000;

server.listen(PORT_HTTP, () => {
  console.log(`HTTP admin en http://localhost:${PORT_HTTP}`);
  console.log(`WebSocket (OCPP) escuchando en ws://localhost:${PORT_HTTP}`);
});
