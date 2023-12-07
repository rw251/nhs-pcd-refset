/*

Get definitions
*/

let definitions;
let refSets;
let refSetNames;

function getDefs(refSetId) {
  if (!definitions) {
    console.log('Definitions not loaded... Waiting 500ms...');
    return setTimeout(() => {
      getDefs(refSetId);
    }, 500);
  }
  console.log('Definitions now loaded.');
  const refSet = refSets[refSetId];
  console.log(refSet.length);
  const numberOfConcepts = refSet.length;
  console.log(numberOfConcepts);
  const concepts = refSet.slice(0, 10000);
  const numberOfConceptsReturned = concepts.length;
  const refSetHTML = concepts
    .map(
      (x) =>
        `<tr><td>${x}</td><td>${
          definitions[x] ? definitions[x].t : ''
        }</td></tr>`
    )
    .join('');
  postMessage({
    msg: 'refset',
    content: {
      numberOfConcepts,
      numberOfConceptsReturned,
      refSetHTML,
      refSetId,
    },
  });

  const data = refSet
    .map((x) => `${x}\t${definitions[x] ? definitions[x].t : ''}`)
    .join('\n');
  postMessage({ msg: 'data', content: { data, refSetId } });
}

onmessage = (e) => {
  const { action, params } = e.data;
  switch (action) {
    case 'load':
      const { folder } = params;
      loadRefSets(folder);
      loadDefinitions(folder);
      break;
    case 'defs':
      const { refSetId } = params;
      getDefs(refSetId);
      break;
    default:
      console.log('Incorrect action received by worker', action);
  }
};

async function loadDefinitions(folder) {
  console.log('loading defs...');
  definitions = await fetch(
    `{URL}/files/processed/${folder}/pcd-defs.json`
  ).then((x) => x.json());
  console.log(new Date().toISOString(), 'Defs loaded');
  postMessage({ msg: 'defsLoaded' });
}

async function loadRefSets(folder) {
  console.log('loading refs...');
  refSets = await fetch(
    `{URL}/files/processed/${folder}/pcd-refSets.json`
  ).then((x) => x.json());
  refSetNames = Object.keys(refSets);
  const refSetHTML = refSetNames
    .map((x) => `<li data-id="${x}">${x} (${refSets[x].length} codes)</li>`)
    .join('');
  console.log(new Date().toISOString(), 'Refs loaded');
  postMessage({ msg: 'refsLoaded', content: { refSetHTML } });
}
