import { makeJWT } from '../packages/client-node/__tests__/utils/jwt'

/** Used to generate a JWT token for web testing (can't use `jsonwebtoken` library directly there)
 *  See `package.json` -> `scripts` -> `test:web:integration:cloud_smt:jwt` */
;(() => {
  console.log(makeJWT())
})()
