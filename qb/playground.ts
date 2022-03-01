// tslint:disable:no-console

import {setupTests} from "./test/setupTeardown";
import e from "./dbschema/edgeql-js";

async function run() {
  const {client} = await setupTests();
  const query = e.select(e.Z, z => ({
    xy: {
      a: true,
      ...e.is(e.X, {
        b: true,
      }),
    },
  }));

  console.log(query.toEdgeQL());

  const result = await query.run(client);
  console.log(JSON.stringify(result, null, 2));

  const q2 = e.insert(e.Z, {
    xy: e.insert(e.Y, {
      c: true,
    }),
  });

  console.log(q2.toEdgeQL());
}

run();
