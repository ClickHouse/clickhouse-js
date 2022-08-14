import * as ch from '../../src/schema';

describe('Schema', () => {
  describe('Table', () => {
    it('should serve as a playground for compiler type hints', async () => {
      const schema = new ch.Schema({
        aString: ch.String,
        anUInt8: ch.UInt8,
        aBool: ch.Bool,
        anArray: ch.Array(ch.UInt8),
        anArrayOfStrings: ch.Array(ch.String),
        aNullableString: ch.Nullable(ch.String),
        aMapOfArrays: ch.Map(ch.String, ch.Array(ch.UInt8)),
        aMapOfMaps: ch.Map(ch.String, ch.Map(ch.UInt8, ch.String)),
      });

      type X = ch.Infer<typeof schema.shape>;

      const x: X = {
        aString: 'foobar',
        anUInt8: 42,
        aBool: true,
        anArray: [1, 2, 3],
        anArrayOfStrings: ['str'],
        aNullableString: null,
        aMapOfArrays: new Map([['key1', [1, 2, 3]]]),
        aMapOfMaps: new Map([['key1', new Map([[42, 'foobar']])]]),
      };
      console.log(x);
      console.log(`${schema}`);
      console.log(schema.toString('\n'));
    });
  });
});
