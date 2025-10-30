import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import logger from '../utils/logger.js';

const INSPECTION_TABLE = process.env.INSPECTION_TABLE!;

const dynamoClient = new DynamoDBClient({
  region: process.env.AWS_REGION!,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

export async function insertInspectionService({
  text,
  attachments,
  name, 
}: {
  text: string;
  attachments?: any[];
  name: string;
}) {
  const now = new Date().toISOString(); // for createdAt / updatedAt

  // --- Extract inspection date & time from name ---
  // Example name: "Vehicle Inspection - ND 456 789 2025-10-23 16:00:26"
  const nameMatch = name.match(/(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/);
  const inspectionDate = nameMatch ? nameMatch[1] : now.split('T')[0];
  const inspectionTime = nameMatch ? nameMatch[2] : now.split('T')[1];

  // --- Extract other fields ---
  const inspectionNo = extractValue(text, 'Inspection No:') || '0';
  const vehicleReg = extractValue(text, 'Vehicle Reg:');
  const vehicleVin = extractValue(text, 'Vehicle Vin:');
  const fleetid = extractValue(text, 'Vehicle ID:');
  const odometerStart = parseFloat(extractValue(text, 'Odometer:')) || 0;
  const inspectorOrDriver = extractValue(text, 'Username:').replace(/"/g, '');

  const bool = (val: string) => val.trim().toLowerCase() === 'yes';
  const getAnswer = (q: string) => bool(extractValue(text, q, 'Answer:'));

  // --- Collect photos from attachments if available ---
  const photos: string[] =
    attachments?.map((a: any) => a.url || a.thumbnail || a.id).filter(Boolean) || [];

  // --- History entry uses exact timestamp from name ---
  const historyEntry = `${inspectorOrDriver} @ ${inspectionDate} ${inspectionTime}: Inspection #${inspectionNo} for vehicle ${vehicleReg}\n`;

  const item: any = {
    id: { S: `${Date.now()}-${Math.random().toString(36).substring(2, 8)}` },
    fleetid: { S: fleetid },
    inspectionNo: { N: inspectionNo },
    vehicleReg: { S: vehicleReg },
    vehicleVin:{S:vehicleVin},
    odometerStart: { N: odometerStart.toString() },
    inspectionDate: { S: inspectionDate },
    inspectionTime: { S: inspectionTime },
    inspectorOrDriver: { S: inspectorOrDriver },
    oilAndCoolant: { BOOL: getAnswer('Are the engine oil and Coolant Level Acceptable?') },
    fuelLevel: { BOOL: getAnswer('Is there a full tank of Fuel?') },
    seatbeltDoorsMirrors: { BOOL: getAnswer("Are the Seatbelts, Doors and Mirror's Functioning Correctly?") },
    handbrake: { BOOL: getAnswer('Is the handbrake Tested and Functional?') },
    tyreCondition: { BOOL: getAnswer('Are all the Tyres wear, Tread, and Pressure Acceptable?') },
    spareTyre: { BOOL: getAnswer('Is there a Spare tyre, jack, Spanner on the vehicle and in good condition?') },
    numberPlate: { BOOL: getAnswer('Is there a valid number plate on the Front and Back of the vehicle?') },
    licenseDisc: { BOOL: getAnswer('Is the License Disc Clearly Visible in the windscreen?') },
    leaks: { BOOL: getAnswer('Is there any signs of leaks under the vehicle prior to start?') },
    lights: { BOOL: getAnswer('Are the headlights, Taillights, Fog Lights, indicators and hazards functioning correctly?') },
    defrosterAircon: { BOOL: getAnswer('Are the defrosters, heaters and air conditioners functional?') },
    emergencyKit: { BOOL: getAnswer('Is there an Emergency Kit within the Vehicle?') },
    clean: { BOOL: getAnswer('Is the car interior and Exterior Clean?') },
    warnings: { BOOL: getAnswer('Are there any warning Lights present on the Dash at start up?') },
    windscreenWipers: { BOOL: getAnswer('Are the Windscreen Wipers in working condition?') },
    serviceBook: { BOOL: getAnswer('Is the Service book within the vehicle?') },
    siteKit: { BOOL: getAnswer('Is there Reflectors, Buggy Whip, Strobe Light within the Vehicle?') },
    photo: { L: photos.map((p) => ({ S: p })) },
    history: { S: historyEntry },
    createdAt: { S: now },
    updatedAt: { S: now },
  };

  console.log(item);

  // --- DynamoDB insert ---
  await dynamoClient.send(new PutItemCommand({ TableName: INSPECTION_TABLE, Item: item }));

  logger.info(`Inspection inserted for vehicle ${vehicleReg} (fleetid: ${fleetid})`);
}

// --- Extractor ---
function extractValue(text: string, key: string, stopKey?: string): string {
  const lines = text.split('\n');
  const idx = lines.findIndex((line) => line.includes(key));
  if (idx === -1) return '';
  if (stopKey) {
    for (let i = idx + 1; i < lines.length; i++) {
      if (lines[i].includes(stopKey)) return lines[i].replace('Answer:', '').trim();
    }
  }
  return lines[idx].replace(key, '').trim();
}
