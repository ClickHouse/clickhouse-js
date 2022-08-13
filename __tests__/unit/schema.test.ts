import { Arr, Bool, Nullable, Str, UInt8 } from '../../src/schema/types';
import { Infer, Schema } from '../../src/schema/schema';

describe('Schema', () => {
  it('should render a CREATE TABLE statement', async () => {
    const myEntitySchema = new Schema('my_table', 'MergeTree', {
      message: Str,
      count: UInt8,
      foo: Bool,
      qaz: Arr(UInt8),
      qux: Nullable(Str),
    });

    type X = Infer<typeof myEntitySchema.shape>;

    const x: X = {
      message: 'foobar',
      count: 42,
      foo: true,
      qaz: [1, 2, 3],
      qux: null,
    };
    console.log(x);
    console.log(myEntitySchema.testCreateTableRender());
  });
});
