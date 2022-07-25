import { createClient, type ClickHouseClient } from '../../src';

describe('error', () => {
  let client: ClickHouseClient;
  afterEach(async () => {
    await client.close();
  });
  it('returns "unknown identifier" error', async() => {
    expect.assertions(4);

    client = createClient();
    try {
      await client.select({
        query: 'SELECT number FR'
      });
    } catch (e: any) {
      expect(e.message).toEqual(expect.any(String));
      expect(e.message.length > 0).toBe(true);

      expect(e.code).toBe('47');
      expect(e.type).toBe('UNKNOWN_IDENTIFIER');
    }
  });

  it('returns "unknown table" error', async() => {
    expect.assertions(5);

    client = createClient();
    try {
      await client.select({
        query: 'SELECT * FROM unknown_table'
      });
    } catch (e: any) {
      expect(e.message).toEqual(expect.any(String));
      expect(e.message).toMatch(/unknown_table doesn't exist/);
      expect(e.message.length > 0).toBe(true);

      expect(e.code).toBe('60');
      expect(e.type).toBe('UNKNOWN_TABLE');
    }
  });

  it('returns "syntax error" error', async() => {
    expect.assertions(5);

    client = createClient();
    try {
      await client.select({
        query: 'SELECT * FRON unknown_table'
      });
    } catch (e: any) {
      expect(e.message).toEqual(expect.any(String));
      expect(e.message).toMatch(/failed at position 15/);
      expect(e.message.length > 0).toBe(true);

      expect(e.code).toBe('62');
      expect(e.type).toBe('SYNTAX_ERROR');
    }
  });
});
