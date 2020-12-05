import * as semver from 'semver'
import { getClient, getDb, S_KEY_DB_VERSION } from '../utils'
import { logger } from '../log'
import { DI, K_APP_MITIGATION } from '../utils'
import { getCollections } from '../db'
import { Db, MongoClient } from 'mongodb'
import { Logger } from 'pino'

type MitigationFn = (args: {
  client: MongoClient
  db: Db
  logger: Logger
}) => Promise<void>

const mitigations = new Map<string, MitigationFn>()

DI.step(K_APP_MITIGATION, async () => {
  const client = await getClient()
  const db = await getDb()
  const { Metas } = getCollections(db)

  const M = [...mitigations.entries()]
  M.sort((a, b) => semver.compare(a[0], b[0]))

  for (const [ver, fn] of M) {
    const cur = await Metas.findOne({ _id: S_KEY_DB_VERSION })
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    if (semver.lt(cur!.value, ver)) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      logger.info(`Mitigate from ${cur!.value} to ${ver}`)
      await fn({ client, db, logger })
      await Metas.updateOne({ _id: S_KEY_DB_VERSION }, { $set: { value: ver } })
    }
  }
})

function defineMitigation(version: string, fn: MitigationFn) {
  mitigations.set(version, fn)
}

defineMitigation('0.0.0', async () => {
  logger.info('Nothing to mitigate')
})

defineMitigation('0.0.1', async ({ client, db }) => {
  const { Tags } = getCollections(db)
  await Tags.updateMany({}, { $set: { content: '' } })
})

defineMitigation('0.0.2', async ({ client, db, logger }) => {
  const collections = await db.listCollections().toArray()
  for (const collection of collections) {
    logger.info('Drop indexes for ' + collection.name)
    await db.command({ dropIndexes: collection.name, index: '*' })
  }
  const { Users, Posts, Tags } = getCollections(db)
  await Users.createIndex('slug', { unique: true, name: 'slug' })
  await Users.createIndex('email', { unique: true, name: 'email' })
  await Posts.createIndex('slug', { unique: true, name: 'slug' })
  await Tags.createIndex('slug', { unique: true, name: 'slug' })
})
