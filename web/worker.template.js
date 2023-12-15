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
  console.log(refSet.active.length);
  console.log(refSet.inactive.length);
  const numberOfActiveConcepts = refSet.active.length;
  const numberOfInactiveConcepts = refSet.inactive.length;
  const numberOfConcepts = refSet.active.length + refSet.inactive.length;
  console.log(numberOfConcepts);
  const concepts = refSet.active.slice(0, 10000 - refSet.inactive.length);
  const numberOfConceptsReturned = concepts.length + refSet.inactive.length;
  const refSetHTML =
    concepts
      .map(
        (x) =>
          `<tr><td>${x}</td><td>${
            definitions[x] ? definitions[x].t : ''
          }</td></tr>`
      )
      .join('') +
    refSet.inactive
      .map(
        (x) =>
          `<tr class="inactive"><td>${x}</td><td>${
            definitions[x] ? definitions[x].t : ''
          }</td></tr>`
      )
      .join('');
  postMessage({
    msg: 'refset',
    content: {
      numberOfActiveConcepts,
      numberOfInactiveConcepts,
      numberOfConcepts,
      numberOfConceptsReturned,
      refSetHTML,
      refSetId,
    },
  });

  const dataActive = refSet.active
    .map((x) => `${x}\t${definitions[x] ? definitions[x].t : ''}`)
    .join('\n');
  const dataInactive = refSet.inactive
    .map((x) => `${x}\t${definitions[x] ? definitions[x].t : ''}`)
    .join('\n');
  postMessage({ msg: 'data', content: { dataActive, dataInactive, refSetId } });
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
    `{URL}/files/processed/${folder}/pcd-defs.json?v=1`
  ).then((x) => x.json());
  console.log(new Date().toISOString(), 'Defs loaded');
  postMessage({ msg: 'defsLoaded' });
}

async function loadRefSets(folder) {
  console.log('loading refs...');
  refSets = await fetch(
    `{URL}/files/processed/${folder}/pcd-refSets.json?v=1`
  ).then((x) => x.json());
  refSetNames = Object.keys(refSets);
  const refSetHTML = refSetNames
    .map((x) => {
      let [part1, part2, thing] = x.split(' - ');
      thing = thing.replace(
        ' simple reference set (foundation metadata concept)',
        ''
      );
      thing = thing.replace('Quality and Outcomes Framework', 'QOF');
      thing = thing[0].toUpperCase() + thing.slice(1);
      return `<li data-id="${x}" data-part1="${part1}" data-part2="${part2}">${thing}<br><span>(${
        refSets[x].active.length
      } active code${refSets[x].active.length !== 1 ? 's' : ''}${
        refSets[x].inactive.length > 0
          ? `, ${refSets[x].inactive.length} inactive code${
              refSets[x].inactive.length !== 1 ? 's' : ''
            }`
          : ''
      })</span></li>`;
    })
    .join('');
  console.log(new Date().toISOString(), 'Refs loaded');
  postMessage({ msg: 'refsLoaded', content: { refSetHTML } });
}
