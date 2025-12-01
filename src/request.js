const axios = require('axios');

const baseUrl = 'http://localhost:8000';

async function getTransactionId() {
    try {
        const response = await axios.get(`${baseUrl}/getColTrans`);
        console.log('Obtenido transactionId:', response.data);
        return response.data;
    } catch (error) {
        console.error('Error obteniendo ID de transacción:', error);
        throw error;
    }
}

async function registerChargepoint(cpId, cpData) {
    try {
        const response = await axios.post(`${baseUrl}/registerChargepoint`, {
            cp_id: cpId,
            cp_data: cpData
        });
        return response.data;
    } catch (error) {
        console.error('Error registrando punto de carga:', error);
        throw error;
    }
}

async function sendHeartbeat(cpId, timestamp) {
    try {
        const response = await axios.post(`${baseUrl}/updateHB`, {
            id: cpId,
            hora: timestamp
        });
        return response.data;
    } catch (error) {
        console.error('Error enviando latido:', error);
        throw error;
    }
}

async function sendStatusNotification(cpId, statusData) {
    try {
        const response = await axios.post(`${baseUrl}/updateConnector`, {
            id_cp: cpId,
            status: statusData.status,
            id_connector: statusData.connectorId,
            date: statusData.timestamp,
            error_code: statusData.errorCode || null,
            info: statusData.info || null
        });
        return response.data;
    } catch (error) {
        console.error('Error enviando notificación de estado:', error);
        throw error;
    }
    
}


async function sendStartTransaction(cpId, transactionData) {
    try {

        const transactionId = await getTransactionId();
        console.log('Obtenido transactionId:', transactionId);
        if (transactionId == undefined) {
            throw new Error('No se pudo obtener un ID de transacción válido');
        }
        console.log('Datos de la transacción:', transactionData);
        const response = await axios.post(`${baseUrl}/setTrans`, {
            id_cp: cpId,
            id_trans: transactionId,
            id_tag: transactionData.idTag,
            meter_start: transactionData.meterStart,
            started: transactionData.timestamp,
            connector_id: transactionData.connectorId,
            status: "CARGANDO",
            reservation_id: transactionData.reservationId || null
        });
        console.log('Respuesta al iniciar transacción:', response.data);
        return { transactionId, ...response.data };
    } catch (error) {
        console.error('Error iniciando transacción:', error);
        throw error;
    }
}

async function sendMeterValues(cpId, meterData) {
    try {
        const response = await axios.post(`${baseUrl}/setMeterValues`, {
            chargepoint_id: cpId,
            connector_id: meterData.connectorId,
            transaction_id: meterData.transactionId,
            meter_value: meterData.meterValue.map(mv => ({
                timestamp: mv.timestamp,
                sampled_value: mv.sampledValue
            }))
        });
        return response.data;
    } catch (error) {
        console.error('Error enviando valores del medidor:', error);
        throw error;
    }
}

async function sendStopTransaction(cpId, stopData) {
    try {
        const response = await axios.post(`${baseUrl}/stopTransaction`, {
            id_trans: stopData.transactionId,
            finished: stopData.timestamp,
            status: "FINALIZADO",
            meter_end: stopData.meterStop,
            message: stopData.reason || ""
        });
        return response.data;
    } catch (error) {
        console.error('Error deteniendo transacción:', error);
        throw error;
    }
}

module.exports = { getTransactionId, registerChargepoint, sendHeartbeat, sendStatusNotification, sendStartTransaction, sendMeterValues, sendStopTransaction };