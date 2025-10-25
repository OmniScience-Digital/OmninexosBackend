import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import logger from '../utils/logger.js';
const INSPECTION_TABLE = process.env.INSPECTION_TABLE;
const dynamoClient = new DynamoDBClient({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
});
export async function insertInspectionService({ text }) {
    const now = new Date().toISOString();
    // Extract fields
    const inspectionNo = extractValue(text, 'Inspection No:');
    const vehicleReg = extractValue(text, 'Vehicle Reg:');
    const fleetid = extractValue(text, 'Vehicle ID:');
    const odometerStart = parseFloat(extractValue(text, 'Odometer:')) || 0;
    const inspectorOrDriver = extractValue(text, 'Username:').replace(/"/g, '');
    const bool = (val) => val.trim().toLowerCase() === 'yes';
    const getAnswer = (q) => bool(extractValue(text, q, 'Answer:'));
    const item = {
        id: { S: `${Date.now()}-${Math.random().toString(36).substring(2, 8)}` },
        fleetid: { S: fleetid },
        inspectionNo: { N: inspectionNo },
        vehicleReg: { S: vehicleReg },
        odometerStart: { N: odometerStart.toString() },
        inspectionDate: { S: now.split('T')[0] },
        inspectionTime: { S: now.split('T')[1] },
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
        emergencyKit: { BOOL: getAnswer('Is the Emergency Kit within the Vehicle?') },
        clean: { BOOL: getAnswer('Is the car interior and Exterior Clean?') },
        warnings: { BOOL: getAnswer('Are there any warning Lights present on the Dash at start up?') },
        windscreenWipers: { BOOL: getAnswer('Are the Windscreen Wipers in working condition?') },
        serviceBook: { BOOL: getAnswer('Is the Service book within the vehicle?') },
        siteKit: { BOOL: getAnswer('Is there Reflectors, Buggy Whip, Strobe Light within the Vehicle?') },
        createdAt: { S: now },
        updatedAt: { S: now },
    };
    console.log(item);
    // await dynamoClient.send(new PutItemCommand({ TableName: INSPECTION_TABLE, Item: item }));
    logger.info(`Inspection inserted for vehicle ${vehicleReg} (fleetid: ${fleetid})`);
}
// Extractor
function extractValue(text, key, stopKey) {
    const lines = text.split('\n');
    const idx = lines.findIndex(line => line.includes(key));
    if (idx === -1)
        return '';
    if (stopKey) {
        for (let i = idx + 1; i < lines.length; i++) {
            if (lines[i].includes(stopKey))
                return lines[i].replace('Answer:', '').trim();
        }
    }
    return lines[idx].replace(key, '').trim();
}
