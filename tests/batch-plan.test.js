import test from 'node:test';
import assert from 'node:assert/strict';
import { splitFloorBatches } from '../src/summary/batchPlan.js';

const defaultWeight = message => String(message.content ?? message.message ?? '').length;
const evenAi = count => Array.from({ length: count }, (_, id) => ({ id, role: id % 2 === 0 ? 'assistant' : 'user', content: 'x'.repeat(12) }));
const weightOf = (message, weight) => Math.max(1, weight(message));

function runsOf(messages) {
  const runs = [];
  for (const message of messages) {
    const run = runs.at(-1);
    if (run && message.id === run.at(-1).id + 1) run.push(message);
    else runs.push([message]);
  }
  return runs;
}

// A reply unit is one user turn plus the AI turn that answers it. Only an AI turn closes one.
function unitsOf(run, weight) {
  const units = [];
  let start = 0, total = 0;
  run.forEach((message, index) => {
    total += weightOf(message, weight);
    if (message.role !== 'assistant') return;
    units.push({ start: run[start].id, end: message.id, count: index - start + 1, weight: total });
    start = index + 1; total = 0;
  });
  return units;
}

function floorIds(run, until) {
  const index = run.findIndex(message => message.id === until);
  return run.slice(0, index + 1).map(message => message.id);
}

// Greedy maximum packing gives the fewest batches a floor cap, and an optional
// heaviest-batch ceiling, can allow. A single unit over either limit travels alone.
function minimumBatches(units, cap, maxWeight = Infinity) {
  let count = 0, index = 0;
  while (index < units.length) {
    let covered = 0, weight = 0;
    while (index < units.length && covered + units[index].count <= cap && weight + units[index].weight <= maxWeight) { covered += units[index].count; weight += units[index].weight; index++; }
    if (!covered) index++;
    count++;
  }
  return count;
}

// Smallest heaviest-batch ceiling that still fits the fewest feasible batches.
function minimalCeiling(units, cap, batches) {
  let low = Math.max(...units.map(unit => unit.weight)), high = units.reduce((sum, unit) => sum + unit.weight, 0);
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (minimumBatches(units, cap, middle) <= batches) high = middle; else low = middle + 1;
  }
  return low;
}

// `bridge` marks a run the caller joined across a gap, where floorCount counts material
// messages instead of the distance between the first and last floor.
function assertBatchInvariants(plans, messages, target, weight = defaultWeight, { bridge = false } = {}) {
  const cap = Math.max(1, Math.floor(target * 1.2));
  const runs = bridge ? [messages] : runsOf(messages);
  const unitIndex = new Map(), expectedFloors = [];
  const units = [];
  for (const run of runs) {
    const runUnits = unitsOf(run, weight);
    runUnits.forEach(unit => {
      units.push(unit);
      for (let id = unit.start; id <= unit.end; id++) unitIndex.set(id, units.length - 1);
    });
    if (runUnits.length) expectedFloors.push(...floorIds(run, runUnits.at(-1).end));
  }
  const covered = [];
  plans.forEach((plan, index) => {
    assert.equal(plan.entryName, `总结${plan.startFloor}-${plan.endFloor}楼`);
    const last = messages.find(message => message.id === plan.endFloor);
    assert(last, `${plan.entryName} 的结束楼层不在材料中`);
    assert.equal(last.role, 'assistant', `${plan.entryName} 未以 AI 回复收尾`);
    assert(unitIndex.has(plan.startFloor) && unitIndex.has(plan.endFloor), `${plan.entryName} 截断了完整回复单元`);
    const floors = messages.filter(message => message.id >= plan.startFloor && message.id <= plan.endFloor);
    assert.equal(plan.floorCount, floors.length, `${plan.entryName} 楼层数与材料不符`);
    if (!bridge) assert.equal(plan.floorCount, plan.endFloor - plan.startFloor + 1, `${plan.entryName} 跨越了材料缺口`);
    assert.equal(plan.materialChars, floors.reduce((sum, message) => sum + weightOf(message, weight), 0), `${plan.entryName} 正文字符数与材料不符`);
    assert(plan.floorCount <= cap || unitIndex.get(plan.startFloor) === unitIndex.get(plan.endFloor), `${plan.entryName} 超出软上限`);
    if (index) {
      const previousEnd = plans[index - 1].endFloor;
      assert(plan.startFloor > previousEnd, '批次必须有序且不重叠');
      assert(messages.filter(message => message.id > previousEnd && message.id < plan.startFloor).every(message => message.role !== 'assistant'), `${plan.entryName} 之前跳过了完整回复单元`);
    }
    covered.push(...floors.map(message => message.id));
  });
  assert.deepEqual(covered, expectedFloors, '批次必须刚好覆盖可总结的完整回复单元');
  for (const run of runs) {
    const runUnits = unitsOf(run, weight);
    if (!runUnits.length) continue;
    const lastFloor = runUnits.at(-1).end, batches = minimumBatches(runUnits, cap);
    const group = plans.filter(plan => plan.startFloor >= run[0].id && plan.endFloor <= lastFloor);
    assert.equal(group.length, batches, `第 ${run[0].id}—${lastFloor} 楼应为软上限下的最少可行批数`);
    assert.equal(Math.max(...group.map(plan => plan.materialChars)), minimalCeiling(runUnits, cap, batches), `第 ${run[0].id}—${lastFloor} 楼的最重批次应达到全局最小正文量`);
  }
  return { cap, units };
}

test('documented targets split a continuous round into balanced batches', () => {
  for (const { count, target, ranges } of [
    { count: 41, target: 40, ranges: [[0, 40]] },
    { count: 41, target: 20, ranges: [[0, 20], [21, 40]] },
    { count: 61, target: 40, ranges: [[0, 30], [31, 60]] },
    { count: 81, target: 40, ranges: [[0, 40], [41, 80]] },
  ]) {
    const messages = evenAi(count), plans = splitFloorBatches(messages, target);
    assert.deepEqual(plans.map(plan => [plan.startFloor, plan.endFloor]), ranges, `${count} 楼、目标 ${target}`);
    assertBatchInvariants(plans, messages, target);
  }
});

test('the soft cap splits instead of overflowing and keeps body weight level', () => {
  for (const [count, target, batches] of [[49, 40, 2], [101, 40, 3]]) {
    const messages = evenAi(count), plans = splitFloorBatches(messages, target);
    assert.equal(plans.length, batches);
    const { cap } = assertBatchInvariants(plans, messages, target);
    assert(plans.every(plan => plan.floorCount <= cap), '每个批次都应在软上限内');
    const mean = plans.reduce((sum, plan) => sum + plan.materialChars, 0) / plans.length;
    plans.forEach(plan => assert(Math.abs(plan.materialChars - mean) <= mean * 0.2, `${plan.entryName} 的正文权重偏离均值过多`));
  }
});

test('an indivisible reply unit may exceed the soft cap when no earlier AI reply closes it', () => {
  const messages = Array.from({ length: 61 }, (_, id) => ({ id, role: id === 60 ? 'assistant' : 'user', content: 'x'.repeat(10) }));
  const plans = splitFloorBatches(messages, 20);
  assert.deepEqual(plans.map(plan => [plan.startFloor, plan.endFloor]), [[0, 60]]);
  assert.equal(plans[0].floorCount, 61);
  assert.equal(plans[0].materialChars, 610);
  assertBatchInvariants(plans, messages, 20);
});

test('a trailing user floor without an AI reply waits for the next round', () => {
  const messages = [...evenAi(41), { id: 41, role: 'user', content: 'x'.repeat(9) }];
  const plans = splitFloorBatches(messages, 40);
  assert.deepEqual(plans.map(plan => [plan.startFloor, plan.endFloor]), [[0, 40]]);
  assertBatchInvariants(plans, messages, 40);
});

test('batch size follows body weight and honours a custom weight callback', () => {
  const messages = Array.from({ length: 80 }, (_, id) => ({ id, role: id % 2 === 0 ? 'assistant' : 'user', content: id < 30 ? 'x'.repeat(500) : 'x' }));
  const plans = splitFloorBatches(messages, 20);
  assert.equal(plans.length, 4);
  assertBatchInvariants(plans, messages, 20);
  assert(plans[0].floorCount < plans.at(-1).floorCount, '正文更重的开头应占用更少楼层');
  const callback = message => (message.role === 'assistant' ? 10 : 1);
  const custom = splitFloorBatches(messages, 20, { weightOf: callback });
  assertBatchInvariants(custom, messages, 20, callback);
  assert.notDeepEqual(custom.map(plan => plan.endFloor), plans.map(plan => plan.endFloor), '自定义权重必须改变切点');
});

test('a heavy opening cannot leave the following batch with the weight it shed', () => {
  // Local greedy cut the first batch at the first floor over the running average
  // (7 floors here) and the next batch then carried the whole heavy remainder.
  const messages = Array.from({ length: 80 }, (_, id) => ({ id, role: id % 2 === 0 ? 'assistant' : 'user', content: 'x'.repeat(id < 30 ? 300 : 10) }));
  const plans = splitFloorBatches(messages, 20);
  const { cap, units } = assertBatchInvariants(plans, messages, 20);
  assert.equal(plans.length, 4);
  assert.equal(Math.max(...plans.map(plan => plan.materialChars)), minimalCeiling(units, cap, 4), '最重批次必须等于全局最小上限');
  assert(plans[0].floorCount > 7, '开局批次不应停在局部贪心的短切点');
  assert(plans[0].materialChars >= plans.reduce((sum, plan) => sum + plan.materialChars, 0) / plans.length, '开局批次应吸收不低于平均值的正文量');
});

test('gaps keep runs apart unless the caller allows bridging them', () => {
  const run = start => Array.from({ length: 10 }, (_, offset) => {
    const id = start + offset;
    return { id, role: id % 2 ? 'assistant' : 'user', content: 'x'.repeat(8) };
  });
  const messages = [...run(0), ...run(20)];
  const split = splitFloorBatches(messages, 40);
  assert.deepEqual(split.map(plan => [plan.startFloor, plan.endFloor]), [[0, 9], [20, 29]]);
  assertBatchInvariants(split, messages, 40);
  assert.deepEqual(splitFloorBatches(messages, 40, { canBridgeGap: () => false }).map(plan => [plan.startFloor, plan.endFloor]), [[0, 9], [20, 29]]);
  const asked = [];
  const bridged = splitFloorBatches(messages, 40, { canBridgeGap: (previous, current) => { asked.push([previous.id, current.id]); return current.id - previous.id === 11; } });
  assert.deepEqual(bridged.map(plan => [plan.startFloor, plan.endFloor]), [[0, 29]]);
  assert.deepEqual(asked, [[9, 20]]);
  assertBatchInvariants(bridged, messages, 40, defaultWeight, { bridge: true });
});

test('a round without a complete reply unit yields no plan and the target must be a positive integer', () => {
  assert.deepEqual(splitFloorBatches([], 20), []);
  assert.deepEqual(splitFloorBatches([{ id: 0, role: 'user', content: 'x' }], 20), []);
  assert.deepEqual(splitFloorBatches([{ id: 0, role: 'assistant', content: 'x' }], 20).map(plan => [plan.startFloor, plan.endFloor]), [[0, 0]]);
  for (const target of [0, -1, 1.5, NaN, undefined]) assert.throws(() => splitFloorBatches([], target), /正整数/);
});

test('generated fixtures never lose, duplicate or overrun a floor', () => {
  let seed = 20260921;
  const random = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  for (let round = 0; round < 48; round++) {
    const messages = [{ id: 0, role: 'assistant', content: '' }];
    let id = 1;
    const size = 40 + Math.floor(random() * 90);
    while (id < size) {
      messages.push({ id, role: random() < 0.45 ? 'assistant' : 'user', content: 'x'.repeat(Math.floor(random() * 40)) });
      id++;
      if (random() < 0.12) id += 1 + Math.floor(random() * 3);
    }
    const target = 1 + Math.floor(random() * 40);
    const plans = splitFloorBatches(messages, target);
    assertBatchInvariants(plans, messages, target);
    const bridged = splitFloorBatches(messages, target, { canBridgeGap: () => true });
    assertBatchInvariants(bridged, messages, target, defaultWeight, { bridge: true });
    assert.equal(bridged[0].startFloor, messages[0].id);
  }
});
