/**
 * Servizi per export dati in più formati
 */

import jsPDF from 'jspdf';
import 'jspdf-autotable';

/**
 * Export dati in formato JSON
 */
export function exportToJson(data, filename = 'data.json') {
  const jsonString = JSON.stringify(data, null, 2);
  downloadFile(jsonString, filename, 'application/json');
}

/**
 * Export dati in formato CSV migliorato
 */
export function exportToCsv(data, filename = 'data.csv') {
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('Data must be a non-empty array');
  }

  const headers = Object.keys(data[0]);
  const csvHeaders = headers.join(',');
  
  const csvRows = data.map(row => {
    return headers.map(header => {
      const value = row[header];
      // Handle null/undefined
      if (value === null || value === undefined) return '';
      // Handle objects/arrays
      if (typeof value === 'object') return JSON.stringify(value);
      // Escape quotes and commas
      const stringValue = String(value);
      if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
        return `"${stringValue.replace(/"/g, '""')}"`;
      }
      return stringValue;
    }).join(',');
  });

  const csvContent = [csvHeaders, ...csvRows].join('\n');
  downloadFile(csvContent, filename, 'text/csv');
}

/**
 * Export dati in formato Excel (CSV con BOM per Excel)
 */
export function exportToExcel(data, filename = 'data.xlsx') {
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('Data must be a non-empty array');
  }

  const headers = Object.keys(data[0]);
  const csvHeaders = headers.join(',');
  
  const csvRows = data.map(row => {
    return headers.map(header => {
      const value = row[header];
      if (value === null || value === undefined) return '';
      if (typeof value === 'object') return JSON.stringify(value);
      const stringValue = String(value);
      if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
        return `"${stringValue.replace(/"/g, '""')}"`;
      }
      return stringValue;
    }).join(',');
  });

  const csvContent = [csvHeaders, ...csvRows].join('\n');
  
  // Add BOM for Excel UTF-8 support
  const bom = '\uFEFF';
  const excelContent = bom + csvContent;
  
  downloadFile(excelContent, filename, 'application/vnd.ms-excel');
}

/**
 * Export dati in formato PDF
 */
export function exportToPdf(data, options = {}) {
  const {
    filename = 'data.pdf',
    title = 'Report Dati',
    headers = [],
    columns = [],
    orientation = 'landscape',
    fontSize = 8,
    headStyles = { fillColor: [59, 130, 246] },
    alternateRowStyles = { fillColor: [245, 245, 245] }
  } = options;

  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('Data must be a non-empty array');
  }

  const doc = new jsPDF({
    orientation,
    unit: 'mm',
    format: 'a4'
  });

  // Add title
  doc.setFontSize(16);
  doc.text(title, 14, 15);

  // Add timestamp
  doc.setFontSize(10);
  doc.text(`Generato: ${new Date().toLocaleString('it-IT')}`, 14, 22);

  // Prepare table data
  const tableData = data.map(row => 
    columns.map(col => row[col] || '')
  );

  // Add table
  doc.autoTable({
    head: [headers],
    body: tableData,
    startY: 30,
    fontSize,
    headStyles,
    alternateRowStyles,
    margin: { top: 30, right: 14, bottom: 14, left: 14 },
    styles: {
      font: 'helvetica',
      fontSize,
      cellPadding: 3
    },
    columnStyles: columns.reduce((acc, col, index) => {
      acc[index] = { cellWidth: 'auto' };
      return acc;
    }, {})
  });

  // Save PDF
  doc.save(filename);
}

/**
 * Export dati sensori in formato specifico
 */
export function exportSensorData(sensorData, format = 'json', options = {}) {
  const { zoneId, nodeId } = options;
  const timestamp = new Date().toISOString().split('T')[0];
  
  const baseFilename = `palestra_${zoneId || nodeId || 'data'}_${timestamp}`;
  
  // Prepare data for export
  const exportData = sensorData.map(reading => ({
    timestamp: reading.timestamp || new Date().toISOString(),
    nodeId: reading.nodeId || nodeId,
    zoneId: reading.zoneId || zoneId,
    ...reading.sensors,
    batteryPercent: reading.batteryPercent,
    rssi: reading.rssi,
    snr: reading.snr
  }));

  switch (format.toLowerCase()) {
    case 'csv':
      exportToCsv(exportData, `${baseFilename}.csv`);
      break;
    case 'excel':
      exportToExcel(exportData, `${baseFilename}.xlsx`);
      break;
    case 'pdf':
      exportToPdf(exportData, {
        filename: `${baseFilename}.pdf`,
        title: `Report Sensori - ${zoneId || nodeId}`,
        headers: ['Timestamp', 'Node ID', 'Zone ID', 'Temperatura (°C)', 'Umidità (%)', 'CO2 (ppm)', 'VOC', 'Luce (lux)', 'Flusso (L/min)', 'Batteria (%)', 'RSSI', 'SNR'],
        columns: ['timestamp', 'nodeId', 'zoneId', 'temperatureC', 'humidityPercent', 'co2Ppm', 'vocIndex', 'lightLux', 'flowLmin', 'batteryPercent', 'rssi', 'snr'],
        ...options
      });
      break;
    case 'json':
    default:
      exportToJson(exportData, `${baseFilename}.json`);
      break;
  }
}

/**
 * Export report storico in formato specifico
 */
export function exportHistoryReport(historyData, options = {}) {
  const { zoneId, format = 'json' } = options;
  const timestamp = new Date().toISOString().split('T')[0];
  const baseFilename = `palestra_history_${zoneId}_${timestamp}`;

  switch (format.toLowerCase()) {
    case 'csv':
      exportToCsv(historyData, `${baseFilename}.csv`);
      break;
    case 'excel':
      exportToExcel(historyData, `${baseFilename}.xlsx`);
      break;
    case 'pdf':
      exportToPdf(historyData, {
        filename: `${baseFilename}.pdf`,
        title: `Report Storico - ${zoneId}`,
        headers: ['Timestamp', 'Valore', 'Unità', 'Sensore', 'Note'],
        columns: ['timestamp', 'value', 'unit', 'sensor', 'notes'],
        ...options
      });
      break;
    case 'json':
    default:
      exportToJson(historyData, `${baseFilename}.json`);
      break;
  }
}

/**
 * Funzione helper per download file
 */
function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  
  // Cleanup
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

/**
 * Componente per selezione formati export
 */
export function ExportOptions({ onExport, data, disabled = false }) {
  const formats = [
    { value: 'json', label: 'JSON', icon: '📄' },
    { value: 'csv', label: 'CSV', icon: '📊' },
    { value: 'excel', label: 'Excel', icon: '📈' },
    { value: 'pdf', label: 'PDF', icon: '📋' }
  ];

  return (
    <div className="export-options">
      <div className="export-options__title">Esporta dati:</div>
      <div className="export-options__formats">
        {formats.map(format => (
          <button
            key={format.value}
            className="export-options__button"
            onClick={() => onExport(format.value)}
            disabled={disabled}
            title={`Esporta in formato ${format.label}`}
          >
            <span className="export-options__icon">{format.icon}</span>
            <span className="export-options__label">{format.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

const dataExportServices = {
  exportToJson,
  exportToCsv,
  exportToExcel,
  exportToPdf,
  exportSensorData,
  exportHistoryReport,
  ExportOptions
};

export default dataExportServices;
