import { expect } from 'chai';
import { formatQueryParams } from '../../src/data_formatter';

describe('formatQueryParams', () => {
  it('formats null', () => {
    expect(formatQueryParams(null)).to.equal('NULL');
  });

  it('formats boolean', () => {
    expect(formatQueryParams(true)).to.equal('1');
    expect(formatQueryParams(false)).to.equal('0');
  });

  it('formats number', () => {
    expect(formatQueryParams(1)).to.equal('1');
  });

  it('formats NaN', () => {
    expect(formatQueryParams(NaN)).to.equal('nan');
  });

  it('formats Infinity', () => {
    expect(formatQueryParams(Infinity)).to.equal('+inf');
    expect(formatQueryParams(+Infinity)).to.equal('+inf');
    expect(formatQueryParams(-Infinity)).to.equal('-inf');
  });

  it('formats an array', () => {
    expect(formatQueryParams([1,2,3])).to.equal('[1,2,3]');
  });

  it('formats an empty Array', () => {
    expect(formatQueryParams([])).to.equal('[]');
  });

  it('formats a date without timezone', () => {
    const date = new Date(Date.UTC(2022, 6, 29, 7, 52, 14));
    expect(formatQueryParams(date)).to.equal('2022-07-29 09:52:14');
  });

  it('does not wrap a string in quotes', () => {
    expect(formatQueryParams('hello')).to.equal('hello');
  });

  it('escapes special characters in an input string', () => {
    expect(formatQueryParams("hel'lo")).to.equal('hel\\\'lo');
    expect(formatQueryParams("hel\\lo")).to.equal('hel\\\\lo');
  });

  it('wraps strings in an array in quotes', () => {
    expect(formatQueryParams(['1', '2'])).to.equal("['1','2']");
  });

  it('formats an object and escapes keys and values', () => {
    expect(formatQueryParams({
      ["na'me"]: "cust'om",
    })).to.equal("{'na\\'me':'cust\\'om'}");
  });

  it('formats a nested object', () => {
    expect(formatQueryParams({
      name: 'custom',
      id: 42,
      params: { refs: [44] }
    })).to.equal("{'name':'custom','id':42,'params':{'refs':[44]}}");
  });

  it('throws on unsupported values', () => {
    expect(() => formatQueryParams(undefined)).to.throw('Unsupported value in query parameters: [undefined].');
    expect(() => formatQueryParams(undefined)).to.throw('Unsupported value in query parameters: [undefined].');
  });
});
