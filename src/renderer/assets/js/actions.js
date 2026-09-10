// The human's control surface.
//
// Design rules that come straight from design.md: actions are quiet buttons,
// confirmation happens inline rather than in a modal, and anything simulated
// says so plainly. A human should never be unsure whether their click left
// this machine.

import { el } from './dom.js';
import { emit } from './bus.js';
import { executeAction } from './api.js';
import { findAction, getActionResult, isPending, setActionResult, setPending } from './store.js';
import { statusTone } from './format.js';

const SIDE_EFFECT_LABEL = {
  none: 'no side effect',
  state: 'changes state here',
  external: 'reaches outside A2H',
};

export function renderActions(ids, options = {}) {
  const actions = ids.map((id) => findAction(id)).filter(Boolean);
  if (actions.length === 0) return null;

  const box = el('div', { class: 'actions' });
  for (const action of actions) {
    box.appendChild(actionRow(action, options));
  }
  return box;
}

function actionRow(action, options) {
  const row = el('div', { class: 'action-row' });

  // `compact` trims the descriptive chrome, nothing else. It used to hide the
  // parameter inputs too, which made any action with required params
  // impossible to run from a block: the button could only ever come back
  // "missing required input". An action that asks for a value needs a field to
  // put it in, wherever it is rendered.
  if (!options.compact && (action.description || action.sideEffect !== 'none')) {
    const meta = [];
    if (action.sideEffect !== 'none') meta.push(SIDE_EFFECT_LABEL[action.sideEffect] || action.sideEffect);
    if (action.simulated) meta.push('simulated');
    row.appendChild(
      el('div', { class: 'action-meta' }, [
        action.description ? el('span', { class: 'action-desc', text: action.description }) : null,
        meta.length ? el('span', { class: 'action-note', text: meta.join(' · ') }) : null,
      ]),
    );
  }

  const controls = el('div', { class: 'action-controls' });
  const inputs = new Map();

  if (action.params && action.params.length) {
    const form = el('div', { class: 'action-params' });
    for (const param of action.params) {
      const input = paramInput(param, inputs);
      form.appendChild(
        el('label', { class: 'action-param' }, [
          el('span', { class: 'action-param-label', text: param.label + (param.required ? ' *' : '') }),
          input,
        ]),
      );
    }
    controls.appendChild(form);
  }

  const button = el('button', {
    class: 'btn action-btn',
    type: 'button',
    disabled: !action.enabled || isPending(action.id),
    text: isPending(action.id) ? 'Working…' : action.label,
  });
  controls.appendChild(button);

  const confirmBox = el('div', { class: 'action-confirm', hidden: true });
  const resultBox = el('div', { class: 'action-result' });
  renderResult(resultBox, getActionResult(action.id));

  button.addEventListener('click', () => {
    if (action.confirm) {
      confirmBox.hidden = false;
      confirmBox.textContent = '';
      confirmBox.appendChild(
        el('span', { class: 'action-confirm-text',
          text: `“${action.label}” ${SIDE_EFFECT_LABEL[action.sideEffect] || 'has a side effect'}. Continue?` }),
      );
      confirmBox.appendChild(
        el('button', {
          class: 'btn action-confirm-yes',
          type: 'button',
          text: 'Continue',
          onclick: () => {
            confirmBox.hidden = true;
            run(action, inputs, button, resultBox);
          },
        }),
      );
      confirmBox.appendChild(
        el('button', {
          class: 'btn action-confirm-no',
          type: 'button',
          text: 'Cancel',
          onclick: () => {
            confirmBox.hidden = true;
          },
        }),
      );
      return;
    }
    run(action, inputs, button, resultBox);
  });

  row.appendChild(controls);
  row.appendChild(confirmBox);
  row.appendChild(resultBox);
  return row;
}

function paramInput(param, inputs) {
  const type = param.type || 'text';
  if (type === 'textarea') {
    const node = el('textarea', { class: 'input', rows: 3, placeholder: param.placeholder || '' });
    if (param.default != null) node.value = String(param.default);
    inputs.set(param.name, () => node.value);
    return node;
  }
  if (type === 'select') {
    const node = el('select', { class: 'input' });
    for (const option of param.options || []) {
      node.appendChild(el('option', { value: option, text: option }));
    }
    if (param.default != null) node.value = String(param.default);
    inputs.set(param.name, () => node.value);
    return node;
  }
  if (type === 'boolean') {
    const node = el('input', { type: 'checkbox', class: 'checkbox' });
    if (param.default === true) node.checked = true;
    inputs.set(param.name, () => (node.checked ? 'true' : 'false'));
    return node;
  }
  const node = el('input', { type: 'text', class: 'input', placeholder: param.placeholder || '' });
  if (param.default != null) node.value = String(param.default);
  inputs.set(param.name, () => node.value);
  return node;
}

async function run(action, inputs, button, resultBox) {
  const params = {};
  for (const [name, read] of inputs) params[name] = read();

  setPending(action.id, true);
  button.disabled = true;
  button.textContent = 'Working…';

  let result;
  try {
    result = await executeAction({ id: action.id, params, confirm: true });
  } catch (err) {
    result = { ok: false, message: `Could not reach the server: ${err.message}`, simulated: false };
  }

  setPending(action.id, false);
  setActionResult(action.id, result);
  button.disabled = !action.enabled;
  button.textContent = action.label;
  renderResult(resultBox, result);

  if (result.ok) {
    // Task status and runs changed on the server — pull the new presentation.
    emit('refresh');
  }
}

function renderResult(box, result) {
  box.textContent = '';
  if (!result) return;
  const tone = result.ok ? statusTone('succeeded') : statusTone('failed');
  box.appendChild(
    el('div', { class: `action-outcome tone-${tone}` }, [
      el('span', { class: 'action-outcome-text', text: result.message || (result.ok ? 'Done.' : 'Failed.') }),
      result.ok && result.simulated ? el('span', { class: 'action-sim', text: 'simulated' }) : null,
    ]),
  );
}

/** Compact audit trail, shown on the actions page. */
export function renderAudit(entries) {
  if (!entries || entries.length === 0) {
    return el('p', { class: 'empty', text: 'No actions have been taken in this session.' });
  }
  const list = el('div', { class: 'audit' });
  for (const entry of entries) {
    list.appendChild(
      el('div', { class: `audit-row${entry.ok ? '' : ' is-failed'}` }, [
        el('span', { class: 'audit-time', text: new Date(entry.at).toLocaleTimeString() }),
        el('span', { class: 'audit-action', text: entry.actionId }),
        el('span', { class: 'audit-executor', text: entry.executor }),
        el('span', { class: 'audit-message', text: entry.message }),
      ]),
    );
  }
  return list;
}
