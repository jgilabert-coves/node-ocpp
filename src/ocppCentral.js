const { v4: uuidv4 } = require("uuid");
const { sendStartTransaction, registerChargepoint, sendHeartbeat, sendStatusNotification, sendMeterValues } = require("./request");

class CentralSystem {
  constructor() {
    this.connections = new Map(); // cpId -> { ws, lastSeen, remote }
    this.pendingCalls = new Map();
  }

  registerConnection(ws, req) {
    // Obtener el ID del cargador desde la URL (ej: ws://localhost:9000/CP001)
    const url = new URL(req.url, `http://${req.headers.host}`);
    const cpId = url.pathname.substring(1); // Eliminar el '/' inicial
    
    // Si no hay ID en la URL, generar uno temporal
    const finalCpId = cpId || `TEMP-${uuidv4().slice(0, 8)}`;
    const remote = req.socket.remoteAddress;
    
    // Registrar la conexión directamente con el ID del cargador
    this.connections.set(finalCpId, { 
      ws, 
      lastSeen: Date.now(), 
      remote, 
      cpId: finalCpId 
    });
    
    console.log(`Cargador conectado: ${finalCpId} desde ${remote}`);
    
    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data);
        this._handleRawMessage(finalCpId, msg);
      } catch (err) {
        console.error("Mensaje inválido:", err.message);
      }
    });

    ws.on("close", () => {
      this.connections.delete(finalCpId);
      console.log(`Cargador desconectado: ${finalCpId}`);
    });
  }

  countChargePoints() {
    return [...this.connections.values()].filter((c) => c.cpId).length;
  }

  listChargePoints() {
    return [...this.connections.entries()].map(([id, c]) => ({
      cpId: id,
      remote: c.remote,
      lastSeen: c.lastSeen,
      vendor: c.chargePointVendor || 'Desconocido',
      model: c.chargePointModel || 'Desconocido',
      serial: c.chargePointSerialNumber || 'Desconocido',
      connected: true
    }));
  }

  _handleRawMessage(tempId, msg) {
    console.log("Mensaje recibido:", msg);
    const type = msg[0];
    if (type === 2) {
      const [_, uid, action, payload] = msg;
      this._handleCall(tempId, uid, action, payload);
    } else if (type === 3) {
      const [_, uid, payload] = msg;
      this._handleCallResult(uid, payload);
    } else if (type === 4) {
      const [_, uid, code, desc, details] = msg;
      this._handleCallError(uid, { code, desc, details });
    }
  }

  async _handleCall(cpId, uid, action, payload) {
    const conn = this.connections.get(cpId);
    if (!conn) return;

    switch (action) {
      case "BootNotification": {
        // Actualizar información del cargador si viene en el mensaje
        if (payload.chargePointSerialNumber) {
          conn.charge_point_serial_number = payload.chargePointSerialNumber;
        }
        if (payload.chargePointVendor) {
          conn.charge_point_vendor = payload.chargePointVendor;
        }
        if (payload.chargePointModel) {
          conn.charge_point_model = payload.chargePointModel;
        }
        
        console.log(`BootNotification recibido de ${cpId}:`, {
          vendor: payload.chargePointVendor,
          model: payload.chargePointModel,
          serial: payload.chargePointSerialNumber
        });

        await registerChargepoint(cpId, payload)
        
        this._sendCallResult(conn.ws, uid, {
          currentTime: new Date().toISOString(),
          interval: 60,
          status: "Accepted",
        });
        break;
      }

      case "Heartbeat": {
        conn.lastSeen = Date.now();

        const hb_response = await sendHeartbeat(cpId, new Date().toISOString());
        console.log(`Heartbeat de ${cpId}:`, hb_response);

        this._sendCallResult(conn.ws, uid, {
          currentTime: new Date().toISOString(),
        });
        break;
      }

      case "StatusNotification": {
        conn.lastSeen = Date.now();
        console.log(`StatusNotification de ${cpId}:`, payload);
        const status_response = await sendStatusNotification(cpId, payload);
        console.log(`Respuesta StatusNotification de ${cpId}:`, status_response);
        this._sendCallResult(conn.ws, uid, {});
        break;
      }

      case "StartTransaction": {
        conn.lastSeen = Date.now();
        console.log(`StartTransaction de ${cpId}:`, payload);
        try {
          const { transactionId, response } = await sendStartTransaction(cpId, payload);
          if (response.result == "Ok") {
            this._sendCallResult(conn.ws, uid, {
              transactionId: transactionId,
              idTagInfo: { status: "Accepted" },
            });
          } else {
            this._sendCallError(
              conn.ws,
              uid,
              "Rejected",
              "Transacción rechazada por el servidor",
              {}
            );
          }
        } catch (error) {
          console.error('Error obteniendo transactionId:', error);
          this._sendCallError(
            conn.ws,
            uid,
            "InternalError",
            "Error obteniendo ID de transacción",
            {}
          );
        }
        break; 
      }

      case "StopTransaction": {
        conn.lastSeen = Date.now();
        console.log(`StopTransaction de ${cpId}:`, payload);
        try {
          const stop_response = await sendStopTransaction(cpId, payload);
          console.log(`Respuesta StopTransaction de ${cpId}:`, stop_response);
          this._sendCallResult(conn.ws, uid, {
            idTagInfo: { status: "Accepted" },
          });
        } catch (error) {
          console.error('Error deteniendo transacción:', error);
          this._sendCallError(
            conn.ws,
            uid,
            "InternalError",
            "Error deteniendo transacción",
            {}
          );
        }
        break;
      }

      case "UnlockConnector": {
        conn.lastSeen = Date.now();
        console.log(`UnlockConnector de ${cpId}:`, payload);
        this._sendCallResult(conn.ws, uid, {
          status: payload.status || "Unlocked",
        });
        break;
      }

      case "Reset": {
        conn.lastSeen = Date.now();
        console.log(`Reset de ${cpId}:`, payload);
        this._sendCallResult(conn.ws, uid, {
          status: payload.status,
        });
        break;
      }

      case "MeterValues": {
        conn.lastSeen = Date.now();
        console.log(`MeterValues de ${cpId}:`, payload);
        //const meter_response = await sendMeterValues(cpId, payload);
        console.log(`Respuesta MeterValues de ${cpId}:`, meter_response);
        this._sendCallResult(conn.ws, uid, {});
        break;
      }

      case "TriggerMessage": {
        conn.lastSeen = Date.now();
        console.log(`TriggerMessage de ${cpId}:`, payload);
        this._sendCallResult(conn.ws, uid, {
          status: "Accepted",
        });
        break;
      }
      
      case "FirmwareStatusNotification": {
        conn.lastSeen = Date.now();
        console.log(`FirmwareStatusNotification de ${cpId}:`, payload);
        this._sendCallResult(conn.ws, uid, {});
        break;
      }

      case "Authorize": {
        conn.lastSeen = Date.now();
        console.log(`Authorize de ${cpId}:`, payload);
        this._sendCallResult(conn.ws, uid, {
          idTagInfo: { status: "Accepted" },
        });
        break;
      }

      case "GetConfiguration": {
        
      }

      default:
        this._sendCallError(
          conn.ws,
          uid,
          "NotSupported",
          `Acción ${action} no implementada`,
          {}
        );
    }
  }

  _handleCallResult(uid, payload) {
    const pending = this.pendingCalls.get(uid);
    if (pending) {
      clearTimeout(pending.timeout);
      pending.resolve(payload);
      this.pendingCalls.delete(uid);
    }
  }

  _handleCallError(uid, err) {
    const pending = this.pendingCalls.get(uid);
    if (pending) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(err.desc));
      this.pendingCalls.delete(uid);
    }
  }

  _send(ws, msg) {
    ws.send(JSON.stringify(msg));
  }

  _sendCall(ws, action, payload, timeout = 8000) {
    const uid = uuidv4();
    this._send(ws, [2, uid, action, payload]);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        this.pendingCalls.delete(uid);
        reject(new Error("Timeout"));
      }, timeout);
      this.pendingCalls.set(uid, { resolve, reject, timeout: t });
    });
  }

  _sendCallResult(ws, uid, payload) {
    this._send(ws, [3, uid, payload]);
  }

  _sendCallError(ws, uid, code, desc, details) {
    this._send(ws, [4, uid, code, desc, details]);
  }

  async sendRemoteStart(cpId, connectorId = 1, idTag = "DEFAULT") {
    const conn = this.connections.get(cpId);
    if (!conn) throw new Error("Cargador no conectado");
    return this._sendCall(conn.ws, "RemoteStartTransaction", {
      connectorId,
      idTag,
    });
  }

  async sendRemoteStop(cpId, transactionId) {
    const conn = this.connections.get(cpId);
    if (!conn) throw new Error("Cargador no conectado");
    return this._sendCall(conn.ws, "RemoteStopTransaction", {
      transactionId,
    });
  }

  async sendUnlockConnector(cpId, connectorId = 1) {
    const conn = this.connections.get(cpId);
    if (!conn) throw new Error("Cargador no conectado");
    return this._sendCall(conn.ws, "UnlockConnector", {
      connectorId,
    });
  }

  async sendReset(cpId, type = "Soft") {
    const conn = this.connections.get(cpId);
    if (!conn) throw new Error("Cargador no conectado");
    return this._sendCall(conn.ws, "Reset", {
      type,
    });
  }

  async sendReserveNow(cpId, connectorId = 1, reservationId = "DEFAULT", idTag = "DEFAULT", expiryDate = null) {
    const conn = this.connections.get(cpId);
    if (!conn) throw new Error("Cargador no conectado");
    return this._sendCall(conn.ws, "ReserveNow", {
      connectorId,
      reservationId,
      idTag,
      expiryDate,
    });
  }

  async sendCancelReservation(cpId, reservationId = "DEFAULT") {
    const conn = this.connections.get(cpId);
    if (!conn) throw new Error("Cargador no conectado");
    return this._sendCall(conn.ws, "CancelReservation", {
      reservationId,
    });
  }

  async broadcast(action, payload) {
    const results = [];
    for (const [cpId, conn] of this.connections.entries()) {
      if (!conn.cpId) continue;
      try {
        const res = await this._sendCall(conn.ws, action, payload);
        results.push({ cpId, ok: true, res });
      } catch (err) {
        results.push({ cpId, ok: false, err: err.message });
      }
    }
    return results;
  }
}

module.exports = CentralSystem;
