import { expect } from 'chai';
import { formatQuerySettings } from '../../src/data_formatter';

describe('formatQuerySettings', () => {
  it('formats boolean', () => {
    expect(formatQuerySettings(true)).to.equal('1');
    expect(formatQuerySettings(false)).to.equal('0');
  });

  it('formats a number', () => {
    expect(formatQuerySettings(1)).to.equal('1');
  });

  it('formats a string', () => {
    expect(formatQuerySettings('42')).to.equal('42');
  });
  it('throws on unsupported values', () => {
    expect(() => formatQuerySettings(undefined as any)).to.throw('Unsupported value in query settings: [undefined].');
    expect(() => formatQuerySettings([1,2] as any)).to.throw('Unsupported value in query settings: [1,2].');
  });
});
