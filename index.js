const fs = require('fs');
const ical = require('ical-toolkit');
const ghpages = require('gh-pages');

const DIST_DIR = 'dist';
const CONFIG_FILE = 'config.json';
const HISTORY_FILE = 'history.json';
const TRIAGERS_KEY = 'triagers';
const ICAL_FILE = 'a11y-triage.ics';
const INDENT = '  ';
const DUTY_START_DATES_KEY = 'duty-start-dates';
const CYCLE_LENGTH_DAYS = 7;
const DAY_TO_MS = 24 * 60 * 60 * 1000;
const CYCLE_LENGTH_MS = CYCLE_LENGTH_DAYS * DAY_TO_MS;

/**
 * Return the parsed results from the config file. Reads file synchronously.
 */
function readConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_FILE));
}

/**
 * Write the given JSON object to the history file. Writes synchronously.
 * @param {*} json 
 */
function writeToHistory(json) {
  const data = JSON.stringify(json, undefined, INDENT);
  fs.writeFileSync(HISTORY_FILE, data);
}

/**
 * Given a date, return the date of the Monday preceding it.
 * @param {Date} date 
 */
function getLastMonday(date) {
  const day = date.getDay() || 7;  
  if (day !== 1) {
    date.setHours(-24 * (day - 1)); 
  }

  return date;
}

/**
 * Append a duty cycle to the triage JSON data and write it to file.
 * Writes synchronously.
 */
function appendDutyCycle({ date, triagerName, triagerData }) {
  const filePath = `${DIST_DIR}/triage.json`;
  let data = fs.readFileSync(filePath);
  const calendar = JSON.parse(data);

  const triagers = calendar[TRIAGERS_KEY];
  const dutyStartDates = calendar[DUTY_START_DATES_KEY];
  if (!dutyStartDates || !triagers) {
    throw `\nFATAL ERROR: Invalid data in calendar ${component}.json`;
  }

  if (!triagers[triagerName]) {
    triagers[triagerName] = triagerData;
  }

  dutyStartDates[date] = triagerName;

  if (!fs.existsSync(DIST_DIR)){
    fs.mkdirSync(DIST_DIR);
  }

  data = JSON.stringify(calendar, undefined, '  ');
  fs.writeFileSync(filePath, data);
}

/**
 * Given a duty cycle history object, return the most recent cycle.
 * 
 * @param {*} params 
 *   @param {*} params.dutyCycleHistory The duty cycle history as formatted in the history file.
 */
function getLastDutyCycle({ dutyCycleHistory }) {
  const dutyDates = Object.keys(dutyCycleHistory).sort();
  if (dutyDates.length < 1) {
    return {};
  }

  const lastDutyDate = dutyDates.slice(-1)[0];
  if (!dutyCycleHistory[lastDutyDate]) {
    throw `\nFATAL ERROR: Invalid data in history file!`;
  }

  const lastTriagerName = dutyCycleHistory[lastDutyDate];
  return {
    lastDutyDate,
    lastTriagerName
  }
}

function generateBugzillaUrl(components) {
  const prefix = 'https://bugzilla.mozilla.org/buglist.cgi?' +
    'priority=--' + 
    '&f1=short_desc' +
    '&bug_type=defect' + 
    '&o1=notsubstring' +
    '&resolution=---' +
    '&query_format=advanced' +
    '&chfield=%5BBug%20creation%5D' +
    '&chfieldfrom=-60d' +
    '&v1=%5Bmeta%5D';
  return prefix + '&' + components.map(componentData => `product=${encodeURIComponent(componentData.product)}&component=${encodeURIComponent(componentData.component)}`).join('&')
}

/**
 * 
 * @param {*} params 
 *   @param {*} params.dutyCycleHistory
 */
function generateIcsFile({ dutyCycleHistory, components }) {
  const builder = ical.createIcsFileBuilder();

  builder.calname = 'Layout Triage';
  builder.timezone = 'America/Los_Angeles';
  builder.tzid = 'America/Los_Angeles';
  builder.additionalTags = {
    'REFRESH-INTERVAL': 'VALUE=DURATION:P1H',
    'X-WR-CALDESC': 'Layout Triage'
  };

  for (let dutyCycleDate in dutyCycleHistory) {
    const triagerName = dutyCycleHistory[dutyCycleDate];
    const dutyCycleDateMs = new Date(dutyCycleDate).getTime();

    builder.events.push({
      start: new Date(dutyCycleDateMs),
      end: new Date(dutyCycleDateMs + CYCLE_LENGTH_MS),
      summary: `Triage Duty: ${triagerName}`,
      allDay: true,
      transp: 'TRANSPARENT',
      description: `<strong>${triagerName}:</strong> ` + 
        `<a href="${generateBugzillaUrl(components)}" title="Bugzilla Query">Bugzilla Query</a>`
    });
  }

  const data = builder.toString();
  fs.writeFileSync(`${DIST_DIR}/${ICAL_FILE}`, data);
}

function generateDutyCycle({ dutyCycleHistory, triagers }) {
  let { lastDutyDate, lastTriagerName } = getLastDutyCycle({ dutyCycleHistory })
  let lastTriagerIdx = -1;
  const triagerNames = Object.keys(triagers);
  const createDateString = date => {
    return date.toISOString().replace(/T.*$/, '');
  }

  if (!lastDutyDate || !lastTriagerName) {
    console.warn('No existing duty cycle history. Generating first cycle.');
    lastDutyDate = createDateString(getLastMonday(new Date()));
  } else {
    lastTriagerIdx = triagerNames.indexOf(lastTriagerName);
    if (lastTriagerIdx === -1) {
      console.warn(`Unable to find triager named ${lastTriagerName} in config. Starting over from first triager.`);
    }
  }

  const nextTriagerIdx = (lastTriagerIdx + 1) % triagerNames.length;
  const nextDutyDateMS = new Date(lastDutyDate).getTime() + CYCLE_LENGTH_MS;
  const nextTriagerName = triagerNames[nextTriagerIdx];
  const nextDutyDate = createDateString(new Date(nextDutyDateMS));

  return {
    date: nextDutyDate,
    triagerName: nextTriagerName,
  };
}

function runUpdate() {
  const { triagers, components } = readConfig();
  const { dutyCycleHistory } = JSON.parse(fs.readFileSync(HISTORY_FILE));
  const { date, triagerName } = generateDutyCycle({ dutyCycleHistory, triagers });

  dutyCycleHistory[date] = triagerName;
  appendDutyCycle({ date, triagerName, triagerData: triagers[triagerName] });
  writeToHistory({ dutyCycleHistory });
  generateIcsFile({ dutyCycleHistory, components });
}

/**
 * Reset all existing data.
 */
function runReset() {
  const resetData = {};
  resetData[TRIAGERS_KEY] = {};
  resetData[DUTY_START_DATES_KEY] = {};
  const resetDataString = JSON.stringify(resetData, undefined, INDENT);

  if (!fs.existsSync(DIST_DIR)){
    fs.mkdirSync(DIST_DIR);
  }

  const filePath = `${DIST_DIR}/triage.json`;
  fs.writeFileSync(filePath, resetDataString);
  writeToHistory({ dutyCycleHistory: {} });
  generateIcsFile({ dutyCycleHistory: {} });
}

function runPublish() {
  ghpages.publish(DIST_DIR, function (err) {
    if (err) {
      console.error('There was an error during publishing.');
    } else {
      console.log('Publish to GitHub was successful.');
    }
  });
}

let args = process.argv.slice(2);
let command = args.shift();

switch (command) {
  case 'update': {
    runUpdate();
    break;
  }

  case 'reset': {
    runReset();
    break;
  }

  case 'publish': {
    runPublish();
    break;
  }
}