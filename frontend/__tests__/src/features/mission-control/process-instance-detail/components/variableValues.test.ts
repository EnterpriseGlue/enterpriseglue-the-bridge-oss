import { describe, expect, it } from 'vitest';
import { parseTypedVariableValue, parseBulkVariableInput } from '@src/features/mission-control/process-instance-detail/components/variableValues';

describe('typed variable parsing', () => {
  it.each([
    ['42', 'Integer', 42], ['-2147483648', 'Integer', -2147483648], ['2147483647', 'Integer', 2147483647],
    ['9007199254740991', 'Long', Number.MAX_SAFE_INTEGER], ['-9007199254740991', 'Long', -Number.MAX_SAFE_INTEGER],
    ['1.25e2', 'Double', 125], ['-0.25', 'Double', -0.25], ['false', 'Boolean', false],
    ['0', 'Integer', 0], ['', 'Long', null], ['', 'String', ''], ['{"x":1}', 'Json', { x: 1 }],
  ])('preserves %s (%s)', (raw, type, expected) => {
    const value = parseTypedVariableValue(String(raw), String(type));
    expect(value).toEqual(expected);
    expect(JSON.parse(JSON.stringify({ value })).value).toEqual(expected);
  });
  it.each([
    ['9007199254740993', 'Long'], ['9007199254740991.1', 'Long'], ['2147483647.000000001', 'Integer'], ['-9007199254740993', 'Long'], ['1.2', 'Long'],
    ['2147483648', 'Integer'], ['-2147483649', 'Integer'], ['42.1', 'Integer'],
    ['1e999', 'Double'], ['-1e999', 'Double'], ['Infinity', 'Double'], ['NaN', 'Double'], ['false', 'Integer'],
  ])('rejects %s (%s) before transport', (raw, type) => expect(() => parseTypedVariableValue(raw, type)).toThrow());
  it.each(['9007199254740993', '9007199254740991.1', '1.00000000000000001'])('rejects rounded typed bulk integer lexemes %s', value => {
    expect(() => parseBulkVariableInput(`{"n":{"type":"Long","value":${value}}}`)).toThrow();
  });
  it('retains exact integer bulk values without rewriting nested native JSON', () => {
    expect(parseBulkVariableInput('{"n":{"type":"Long","value":9007199254740991},"i":{"type":"Integer","value":"42"},"j":{"type":"Json","value":{"type":"Long","value":1.25}}}'))
      .toEqual({ n: { type: 'Long', value: Number.MAX_SAFE_INTEGER }, i: { type: 'Integer', value: 42 }, j: { type: 'Json', value: { type: 'Long', value: 1.25 } } });
  });
});
