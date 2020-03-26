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

const BZ_QUERY = 'https://bugzilla.mozilla.org/buglist.cgi?f17=OP&v10=Core&f10=product&f15=component&f5=CP&o11=equals&v15=Accessibility%20Tools&o2=casesubstring&query_format=advanced&f14=product&f18=product&f9=OP&v14=DevTools&f16=CP&v18=Firefox&chfieldfrom=-60d&f20=CP&o7=equals&f6=OP&o19=equals&resolution=---&o4=anyexact&o3=notsubstring&o18=equals&o14=equals&chfield=%5BBug%20creation%5D&j_top=OR&f2=keywords&f11=component&v2=access&f12=CP&o15=equals&v11=Disability%20Access%20APIs&f8=OP&o10=equals&j8=OR&f3=status_whiteboard&v3=%5Baccess-p&f1=OP&f4=product&f21=CP&v19=Disability%20Access&f22=CP&f13=OP&v4=Core%2CFirefox%2CDevTools%2CToolkit&f19=component&f7=priority&v7=--&classification=Client%20Software&classification=Developer%20Infrastructure&classification=Components&classification=Server%20Software&classification=Other';
const FENIX_QUERY = 'https://github.com/mozilla-mobile/fenix/issues?q=is%3Aopen+is%3Aissue+label%3Aneeds%3Atriage+label%3Ab%3Aa11y';

function formatDateForGitHub(date) {
  let d = new Date(date),
    month = '' + (d.getMonth() + 1),
    day = '' + d.getDate(),
    year = d.getFullYear();

  if (month.length < 2) month = '0' + month;
  if (day.length < 2) day = '0' + day;

  return [year, month, day].join('-');
}

function getFenixQuery(dutyCycleDate) {
  const url = FENIX_QUERY;
  const dutyCycleDateMs = new Date(dutyCycleDate).getTime();
  const filterDate = new Date(dutyCycleDateMs - DAY_TO_MS * 60);
  return url + '+created%3A%3E' + formatDateForGitHub(filterDate);
}

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
 * Given a date, return the date of the Sunday preceding it.
 * @param {Date} date 
 */
function getLastSunday(date) {
  const day = date.getDay() || 7;  
  if (day !== 0) {
    date.setHours(-24 * day); 
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
    throw `\nFATAL ERROR: Invalid data in calendar triage.json`;
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

/**
 * 
 * @param {*} params 
 *   @param {*} params.dutyCycleHistory
 */
function generateIcsFile({ dutyCycleHistory }) {
  const builder = ical.createIcsFileBuilder();

  builder.calname = 'a11y Team Triage';
  builder.timezone = 'America/Los_Angeles';
  builder.tzid = 'America/Los_Angeles';
  builder.additionalTags = {
    'REFRESH-INTERVAL': 'VALUE=DURATION:P1H',
    'X-WR-CALDESC': 'a11y Team Triage'
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
      description: `On duty this week: <strong>${triagerName}</strong>` + 
        `<ul>` +
        `<li><a href="${BZ_QUERY}" title="Bugzilla query">Untriaged Bugs in Bugzilla</a></li>` +
        `<li><a href="${getFenixQuery(dutyCycleDate)}" title="Fenix query">Untriaged Fenix Bugs</a></li>` +
        `</ul>`
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
    lastDutyDate = createDateString(getLastSunday(new Date()));
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
  const { triagers } = readConfig();
  const { dutyCycleHistory } = JSON.parse(fs.readFileSync(HISTORY_FILE));
  const { date, triagerName } = generateDutyCycle({ dutyCycleHistory, triagers });

  dutyCycleHistory[date] = triagerName;
  appendDutyCycle({ date, triagerName, triagerData: triagers[triagerName] });
  writeToHistory({ dutyCycleHistory });
  generateIcsFile({ dutyCycleHistory });
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