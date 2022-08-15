import * as ch from '../../src/schema';
import { createClient } from '../../src';
import { Infer, InsertStream } from '../../src/schema';

export default async () => {
  const client = createClient();

  const schema = new ch.Schema({
    id: ch.UInt64,
    name: ch.String,
    externalIds: ch.Array(ch.UInt64),
    settings: ch.Map(ch.String, ch.String),
  });

  type Data = Infer<typeof schema.shape>;

  const table = new ch.Table(client, {
    name: 'sample_table',
    schema,
  });

  const insertStream = new InsertStream<Data>();
  insertStream.add({
    id: 42,
    name: 'foo',
    externalIds: [1, 2],
    settings: new Map([['foo', 'bar']]),
  });
  await table.insert({
    values: insertStream,
    // should match the order of the fields in the database
    compactJson: ({ id, name, externalIds, settings }) => [
      id,
      name,
      externalIds,
      settings,
    ],
  });

  const selectStream = await table.select();
  selectStream.onData(({ id }) => {
    console.log(id);
  });
};
