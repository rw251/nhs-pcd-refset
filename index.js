/*
 * 1. Gets the latest zip file from the TRUD website (unless already downloaded)
 *  - You need a TRUD account
 *  - Put your login detatils in the .env file
 *  - Make sure you are subscribed to "SNOMED CT UK Drug Extension, RF2: Full, Snapshot & Delta"
 * 2.
 *
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  createWriteStream,
  createReadStream,
  writeFileSync,
  copyFileSync,
} from 'fs';
import { Readable } from 'stream';
import { finished } from 'stream/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';
import { JsonStreamStringify } from 'json-stream-stringify';
import unzip from 'unzip-stream';
import { compress } from 'brotli';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let Cookie;

const FILES_DIR = path.join(__dirname, 'files');
const ZIP_DIR = ensureDir(path.join(FILES_DIR, 'zip/'), true);
const RAW_DIR = ensureDir(path.join(FILES_DIR, 'raw'), true);
const PROCESSED_DIR = ensureDir(path.join(FILES_DIR, 'processed'), true);
const CODE_LOOKUP = path.join(FILES_DIR, 'code-lookup.json');

const existingFiles = readdirSync(ZIP_DIR);

function ensureDir(filePath, isDir) {
  mkdirSync(isDir ? filePath : path.dirname(filePath), { recursive: true });
  return filePath;
}

if (!process.env.email) {
  console.log('Need email=xxx in the .env file');
  process.exit();
}
if (!process.env.password) {
  console.log('Need password=xxx in the .env file');
  process.exit();
}

// Check that SNOMED definitions exist on this pc
const DEFINITION_FILE = path.join(
  __dirname,
  '..',
  'nhs-snomed',
  'files',
  'processed',
  'latest',
  'defs.json'
);
if (!existsSync(DEFINITION_FILE)) {
  console.log(`This project relies on another git project (https://github.com/rw251/nhs-snomed) being present.

Please clone that repo so that the nhs-snomed directory is at the same level as the nhs-pcd-refset directory.

Then navigate into the nhs-snomed directory and execute:

node index.js

to create the SNOMED definitions file.`);
  process.exit();
}
const SNOMED_DEFINITIONS = JSON.parse(readFileSync(DEFINITION_FILE, 'utf8'));

async function login() {
  if (Cookie) return;
  const email = process.env.email;
  const password = process.env.password;

  console.log('> Logging in to TRUD...');
  const result = await fetch(
    'https://isd.digital.nhs.uk/trud/security/j_spring_security_check',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      redirect: 'manual',
      body: new URLSearchParams({
        j_username: email,
        j_password: password,
        commit: 'LOG+IN',
      }),
    }
  );
  const cookies = result.headers.getSetCookie();
  const cookie = cookies.filter((x) => x.indexOf('JSESSIONID') > -1)[0];
  console.log('> Logged in, and cookie cached.');
  Cookie = cookie;
}

async function getLatestUrl() {
  await login();
  const response = await fetch(
    'https://isd.digital.nhs.uk/trud/users/authenticated/filters/0/categories/8/items/659/releases',
    { headers: { Cookie } }
  );
  const html = await response.text();
  const downloads = html
    .match(/https:\/\/isd.digital.nhs.uk\/download[^"]+(?:")/g)
    .map((url) => {
      const [, zipFileName] = url.match(/\/([^/]+.zip)/);
      return { url, zipFileName };
    });

  return { url: downloads[0].url };
}

async function downloadIfNotExists({ url }) {
  await login();

  const zipFileName = url.split('/').reverse()[0].split('?')[0];
  console.log(`> Target zip file on TRUD is ${zipFileName}`);

  if (existingFiles.indexOf(zipFileName) > -1) {
    console.log(`> The zip file already exists so no need to download again.`);
    return { zipFileName };
  }

  console.log(`> That zip is not stored locally. Downloading...`);
  const outputFile = path.join(ZIP_DIR, zipFileName);
  const stream = createWriteStream(ensureDir(outputFile));
  const { body } = await fetch(url, { headers: { Cookie } });
  await finished(Readable.fromWeb(body).pipe(stream));
  console.log(`> File downloaded.`);
  return { zipFileName };
}

async function extractZip({ zipFileName }) {
  const dirName = zipFileName.replace('.zip', '');
  const file = path.join(ZIP_DIR, zipFileName);
  const outDir = path.join(RAW_DIR, dirName);
  if (existsSync(outDir)) {
    console.log(
      `> The directory ${outDir} already exists, so I'm not unzipping.`
    );
    return { dirName };
  }
  console.log(`> The directory ${outDir} does not yet exist. Creating...`);
  ensureDir(outDir, true);
  console.log(`> Extracting files from the zip...`);
  let toUnzip = 0;
  let unzipped = 0;
  let isRead = false;
  await new Promise((resolve) => {
    createReadStream(file)
      .pipe(unzip.Parse())
      .on('entry', function (entry) {
        /*
              file.path.toLowerCase().indexOf('full') > -1
      file.path.toLowerCase().indexOf('readme') > -1
      file.path.toLowerCase().indexOf('information') > -1
        */
        if (
          entry.path.toLowerCase().match(/full.+content.+refset_simple/) ||
          entry.path.toLowerCase().match(/full.+sct2_description/)
        ) {
          console.log(`> Extracting ${entry.path}...`);
          toUnzip++;
          const outputFilePath = path.join(outDir, entry.path);
          const outStream = createWriteStream(ensureDir(outputFilePath));
          outStream.on('finish', () => {
            console.log(`> Extracted ${entry.path}.`);
            unzipped++;
            if (isRead && toUnzip === unzipped) {
              return resolve();
            }
          });
          entry.pipe(outStream);
        } else {
          entry.autodrain();
        }
      })
      .on('end', () => {
        console.log(`> Finished reading zip file.`);
        isRead = true;
        if (toUnzip === unzipped) {
          return resolve();
        }
      });
  });
  console.log(`> ${unzipped} files extracted.`);
  return { dirName };
}

function getFileNames(dir, startingFromProjectDir) {
  const rawFilesDir = path.join(RAW_DIR, dir);
  const processedFilesDirFromRoot = path.join(PROCESSED_DIR, dir);
  const processedFilesDir = startingFromProjectDir
    ? path.join('files', 'processed', dir)
    : processedFilesDirFromRoot;
  const definitionJsonFile = path.join(processedFilesDir, 'pcd-defs.json');
  const refSetJsonFile = path.join(processedFilesDir, 'pcd-refSets.json');
  const definitionFileBrotli = path.join(
    processedFilesDirFromRoot,
    'pcd-defs.json.br'
  );
  const refSetFileBrotli = path.join(
    processedFilesDirFromRoot,
    'pcd-refSets.json.br'
  );
  return {
    rawFilesDir,
    definitionJsonFile,
    refSetJsonFile,
    definitionFileBrotli,
    refSetFileBrotli,
    processedFilesDir,
    processedFilesDirFromRoot,
  };
}

async function loadDataIntoMemory({ dirName }) {
  const {
    processedFilesDirFromRoot,
    rawFilesDir,
    definitionJsonFile,
    refSetJsonFile,
  } = getFileNames(dirName);
  if (existsSync(definitionJsonFile) && existsSync(refSetJsonFile)) {
    console.log(`> The json files already exist so I'll move on...`);
    return dirName;
  }
  if (!existsSync(processedFilesDirFromRoot)) {
    mkdirSync(processedFilesDirFromRoot);
  }
  const PCD_DIR = path.join(
    rawFilesDir,
    readdirSync(rawFilesDir).filter((x) => x.indexOf('PrimaryCare') > -1)[0]
  );
  const REFSET_DIR = path.join(PCD_DIR, 'Full', 'Refset', 'Content');
  const refsetFile = path.join(
    REFSET_DIR,
    readdirSync(REFSET_DIR).filter((x) => x.indexOf('Simple') > -1)[0]
  );
  const refSets = {};
  const allConcepts = {};
  readFileSync(refsetFile, 'utf8')
    .split('\n')
    .forEach((row) => {
      const [
        id,
        effectiveTime,
        active,
        moduleId,
        refsetId,
        referencedComponentId,
      ] = row.replace(/\r/g, '').split('\t');
      if (id === 'id' || !referencedComponentId) return;
      if (!refSets[refsetId]) {
        allConcepts[refsetId] = true;
        refSets[refsetId] = {};
      }
      if (!refSets[refsetId][id]) {
        refSets[refsetId][id] = {
          effectiveTime,
          conceptId: referencedComponentId,
        };
        if (active === '1') {
          refSets[refsetId][id].active = true;
        }
      } else {
        if (refSets[refsetId][id].conceptId !== referencedComponentId) {
          console.log(
            `An unexpected error. I thought that if the id (${id}) was the same, then the conceptid (${referencedComponentId}) would be the same.`
          );
          console.log('Need to rewrite the code...');
          process.exit();
        }
        if (effectiveTime > refSets[refsetId][id].effectiveTime) {
          refSets[refsetId][id].effectiveTime = effectiveTime;
          refSets[refsetId][id].active = active === '1';
        }
      }
      allConcepts[referencedComponentId] = true;
    });
  console.log(
    `> Ref set file loaded. It has ${Object.keys(refSets).length} rows.`
  );

  // Now process it a bit
  Object.keys(refSets).forEach((refSetId) => {
    const active = Array.from(
      new Set(
        Object.values(refSets[refSetId])
          .filter((x) => x.active)
          .map((x) => x.conceptId)
      )
    );
    const inactive = Array.from(
      new Set(
        Object.values(refSets[refSetId])
          .filter((x) => !x.active)
          .map((x) => x.conceptId)
      )
    );
    refSets[refSetId] = {
      active,
      inactive,
    };
  });

  const snomedDefsSize = Object.keys(SNOMED_DEFINITIONS).length;
  const TERM_DIR = path.join(PCD_DIR, 'Full', 'Terminology');
  const descFile = path.join(
    TERM_DIR,
    readdirSync(TERM_DIR).filter((x) => x.indexOf('_Description_') > -1)[0]
  );
  readFileSync(descFile, 'utf8')
    .split('\n')
    .forEach((row) => {
      const [
        id,
        effectiveTime,
        active,
        moduleId,
        conceptId,
        languageCode,
        typeId,
        term,
        caseSignificanceId,
      ] = row.replace(/\r/g, '').split('\t');
      if (id === 'id' || !conceptId) return;

      if (!SNOMED_DEFINITIONS[conceptId]) SNOMED_DEFINITIONS[conceptId] = {};
      if (!SNOMED_DEFINITIONS[conceptId][id]) {
        SNOMED_DEFINITIONS[conceptId][id] = { t: term, e: effectiveTime };
        if (active === '1') {
          SNOMED_DEFINITIONS[conceptId][id].a = 1;
        }
        if (typeId === '900000000000003001') {
          SNOMED_DEFINITIONS[conceptId][id].m = 1;
        }
      } else {
        if (effectiveTime > SNOMED_DEFINITIONS[conceptId][id].e) {
          SNOMED_DEFINITIONS[conceptId][id].t = term;
          SNOMED_DEFINITIONS[conceptId][id].e = effectiveTime;
          if (active === '1') {
            SNOMED_DEFINITIONS[conceptId][id].a = 1;
          } else {
            delete SNOMED_DEFINITIONS[conceptId][id].a;
          }
          if (typeId === '900000000000003001') {
            SNOMED_DEFINITIONS[conceptId][id].m = 1;
          } else {
            delete SNOMED_DEFINITIONS[conceptId][id].m;
          }
        }
      }
    });
  //
  console.log(
    `> Description file loaded and added to main SNOMED dictionary.
    Previously the SNOMED dictionary had ${snomedDefsSize} concepts.
    It now has ${Object.keys(SNOMED_DEFINITIONS).length} concepts.`
  );
  const simpleDefs = {};

  Object.keys(allConcepts).forEach((conceptId) => {
    if (SNOMED_DEFINITIONS[conceptId]) {
      // pick best definition

      // if we have any that are active AND main then pick most recent
      const activeAndMainDef = Object.values(SNOMED_DEFINITIONS[conceptId])
        .filter((data) => data.a && data.m)
        .sort((a, b) => {
          if (a.e > b.e) return -1;
          return a.e === b.e ? 0 : 1;
        });

      if (activeAndMainDef.length > 0) {
        simpleDefs[conceptId] = activeAndMainDef[0];
        return;
      }

      // if no mains, but some actives, pick most recent
      const activeAndSynDef = Object.values(SNOMED_DEFINITIONS[conceptId])
        .filter((data) => data.a && !data.m)
        .sort((a, b) => {
          if (a.e > b.e) return -1;
          return a.e === b.e ? 0 : 1;
        });

      if (activeAndSynDef.length > 0) {
        simpleDefs[conceptId] = activeAndSynDef[0];
        return;
      }

      // if main but no actives, pick most recent
      const inactiveAndMainDef = Object.values(SNOMED_DEFINITIONS[conceptId])
        .filter((data) => !data.a && data.m)
        .sort((a, b) => {
          if (a.e > b.e) return -1;
          return a.e === b.e ? 0 : 1;
        });

      if (inactiveAndMainDef.length > 0) {
        simpleDefs[conceptId] = inactiveAndMainDef[0];
        return;
      }

      // no main and no active - investigate
      const inactiveAndMSynDef = Object.values(SNOMED_DEFINITIONS[conceptId])
        .filter((data) => !data.a && !data.m)
        .sort((a, b) => {
          if (a.e > b.e) return -1;
          return a.e === b.e ? 0 : 1;
        });

      if (inactiveAndMSynDef.length > 0) {
        simpleDefs[conceptId] = inactiveAndMSynDef[0];
        return;
      }
      console.log(`ERROR - no defintions found at all for ${conceptId}`);
    } else {
      //console.log(conceptId);
      //TODO? maybe keep track of them here?
    }
  });

  const simpleRefSets = {};

  Object.keys(refSets).forEach((refSetId) => {
    if (!simpleDefs[refSetId])
      console.log(`No description for refset with id: ${refSetId}`);
    else {
      const def = simpleDefs[refSetId].t;
      if (simpleRefSets[def])
        console.log(`There is already an entry for: ${def}`);
      else {
        simpleRefSets[def] = refSets[refSetId];
      }
    }
  });

  // Find snomed codes without definition

  // First get the lookup of unknown codes
  const knownCodeLookup = existsSync(CODE_LOOKUP)
    ? JSON.parse(readFileSync(CODE_LOOKUP, 'utf8'))
    : {};

  const unknownCodes = Object.values(simpleRefSets)
    .map((x) => x.active.concat(x.inactive))
    .flat()
    .filter((conceptId) => !simpleDefs[conceptId])
    .map((conceptId) => {
      if (knownCodeLookup[conceptId]) {
        simpleDefs[conceptId] = knownCodeLookup[conceptId];
        return false;
      }
      return conceptId;
    })
    .filter(Boolean);

  if (unknownCodes.length > 0) {
    console.log(
      `> There are ${unknownCodes.length} codes without a definition.term`
    );
    console.log(`> Attempting to look them up in the NHS SNOMED browser...`);
  }

  async function process40UnknownConcepts(items) {
    console.log(`Looking up next 40 (out of ${items.length})`);
    const next40 = items.splice(0, 40);
    const fetches = next40.map((x) => {
      return fetch(
        `https://termbrowser.nhs.uk/sct-browser-api/snomed/uk-edition/v20230927/concepts/${x}`
      ).then((x) => x.json());
    });
    const results = await Promise.all(fetches).catch((err) => {
      console.log(
        'Error retrieving data from NHS SNOMED browser. Rerunning will probably be fine.'
      );
      process.exit();
    });
    results.forEach(({ conceptId, fsn, effectiveTime, active }) => {
      const def = {
        t: fsn,
        e: effectiveTime,
        m: 1,
      };
      if (active) def.a = 1;
      knownCodeLookup[conceptId] = def;
      simpleDefs[conceptId] = def;
    });
    writeFileSync(CODE_LOOKUP, JSON.stringify(knownCodeLookup, null, 2));
    const next = 2000 + Math.random() * 5000;
    if (items.length > 0) {
      console.log(`Waiting ${next} milliseconds before next batch...`);
      return new Promise((resolve) => {
        setTimeout(async () => {
          await process40UnknownConcepts(items);
          return resolve();
        }, next);
      });
    }
  }

  if (unknownCodes.length > 0) {
    await process40UnknownConcepts(unknownCodes);
  }

  writeFileSync(definitionJsonFile, JSON.stringify(simpleDefs, null, 2));
  writeFileSync(refSetJsonFile, JSON.stringify(simpleRefSets, null, 2));

  return dirName;
}

function brot(file, fileBrotli) {
  console.log(`> Compressing ${file}...`);
  const result = compress(readFileSync(file), {
    extension: 'br',
    quality: 11, //compression level - 11 is max
  });
  console.log(`> Compressed. Writing to ${fileBrotli}...`);
  writeFileSync(fileBrotli, result);
}

function compressJson(dir) {
  const {
    definitionJsonFile,
    refSetJsonFile,
    definitionFileBrotli,
    refSetFileBrotli,
  } = getFileNames(dir);
  if (existsSync(definitionFileBrotli) && existsSync(refSetFileBrotli)) {
    console.log(`> The brotli files already exist so I'll move on...`);
    // const definitions = JSON.parse(readFileSync(definitionFile));
    // const refSets = JSON.parse(readFileSync(definitionFile));
    return dir;
  }

  console.log('> Starting compression...');

  brot(refSetJsonFile, refSetFileBrotli);
  brot(definitionJsonFile, definitionFileBrotli);
  console.log(`> All compressed.`);
  return dir;
}

function rest() {
  const versions = readdirSync(PROCESSED_DIR).filter((x) => x !== '.gitignore');
  writeFileSync(
    path.join(__dirname, 'web', 'routes.json'),
    JSON.stringify(versions, null, 2)
  );
}

import {
  S3Client,
  HeadObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';

let s3;
async function uploadToS3(file, brotliFile) {
  const posixFilePath = file.split(path.sep).join(path.posix.sep);
  const params = {
    Bucket: 'nhs-drug-refset',
    Key: posixFilePath,
  };

  const exists = await s3
    .send(new HeadObjectCommand(params))
    .then((x) => {
      console.log(`> ${file} already exists in R2 so skipping...`);
      return true;
    })
    .catch((err) => {
      if (err.name === 'NotFound') return false;
    });

  if (!exists) {
    console.log(`> ${file} does not exist in R2. Uploading...`);
    await s3.send(
      new PutObjectCommand({
        Bucket: 'nhs-drug-refset',
        Key: posixFilePath,
        Body: readFileSync(brotliFile),
        ContentEncoding: 'br',
        ContentType: 'application/json',
      })
    );
    console.log('> Uploaded.');
  }
}

async function uploadToR2(dir) {
  const accessKeyId = `${process.env.ACCESS_KEY_ID}`;
  const secretAccessKey = `${process.env.SECRET_ACCESS_KEY}`;
  const endpoint = `https://${process.env.ACCOUNT_ID}.r2.cloudflarestorage.com`;

  const {
    definitionJsonFile,
    refSetJsonFile,
    definitionFileBrotli,
    refSetFileBrotli,
  } = getFileNames(dir, true);

  s3 = new S3Client({
    region: 'auto',
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
    endpoint,
  });
  await uploadToS3(definitionJsonFile, definitionFileBrotli);
  await uploadToS3(refSetJsonFile, refSetFileBrotli);
}

// Get latest TRUD version
getLatestUrl()
  .then(downloadIfNotExists)
  .then(extractZip)
  .then(loadDataIntoMemory)
  .then(compressJson)
  .then(uploadToR2)
  .then(rest);
