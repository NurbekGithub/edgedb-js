// tslint:disable:no-console
import {setupTests} from "./test/setupTeardown";
import e from "./dbschema/edgeql-js";
import {createClient} from "edgedb";

const client = createClient();

async function run() {
  const {client} = await setupTests();

  const query = e.select(e.Movie, () => ({
    title: true,
    __type__: {id: true, name: true}
  }));

  console.log(query.toEdgeQL());

  const result = await query.run(client);

  console.log(result);
}

run();
