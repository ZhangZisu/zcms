import S from 'fluent-schema'
import fp from 'fastify-plugin'
import fastifyJwt from 'fastify-jwt'
import { Db, ObjectId } from 'mongodb'
import { DI, K_DB, notNull, S_KEY_JWT_SECRET, verifyPassword } from '../utils'
import { FastifyRequest, preValidationHookHandler } from 'fastify'
import { getCollections, IUserDoc } from '../db'
import { UserDTO } from './common'

declare module 'fastify' {
  interface FastifyInstance {
    auth: {
      login: preValidationHookHandler
      admin: preValidationHookHandler
    }
  }

  interface FastifyRequest {
    ctx: {
      user?: IUserDoc
    }
  }
}

export const authPlugin = fp(async (V) => {
  const db = await DI.waitFor<Db>(K_DB)
  const { Metas, Users } = getCollections(db)
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const jwtMeta = (await Metas.findOne({ slug: S_KEY_JWT_SECRET }))!
  V.register(fastifyJwt, { secret: jwtMeta.value })

  V.decorate('auth', {
    login: async (req: FastifyRequest) => {
      if (!req.ctx.user) throw V.httpErrors.forbidden()
    },
    admin: async (req: FastifyRequest) => {
      if (!req.ctx.user?.perm.admin) throw V.httpErrors.forbidden()
    }
  })

  V.decorateRequest('ctx', null)

  // Initialize context
  V.addHook('preValidation', async (req) => {
    req.ctx = {}
  })

  // Parse authorization
  V.addHook('preValidation', async (req) => {
    if ('authorization' in req.headers) {
      const r = <any>await req.jwtVerify()
      if (!r._id || typeof r._id !== 'string') throw V.httpErrors.forbidden()
      const user = await Users.findOne(
        { _id: new ObjectId(r._id) },
        { projection: { pass: 0 } }
      )
      if (!user) throw V.httpErrors.forbidden()
      req.ctx.user = user
    }
  })

  V.post(
    '/login',
    {
      schema: {
        body: S.object()
          .prop('login', S.string().required())
          .prop('pass', S.string().required())
          .prop('expires', S.enum(['1d', '1m']).default('1d')),
        response: {
          200: S.object().prop('user', UserDTO).prop('token', S.string())
        }
      }
    },
    async (req) => {
      const { body } = <any>req
      const user = await Users.findOne({
        $or: [{ slug: body.login }, { email: body.login }]
      })
      notNull(user)
      if (!(await verifyPassword(body.pass, user.pass))) {
        throw V.httpErrors.forbidden()
      }
      const token = V.jwt.sign({ _id: user._id }, { expiresIn: body.expires })
      return { user, token }
    }
  )

  V.get(
    '/session',
    {
      preValidation: [V.auth.login],
      schema: {
        response: {
          200: S.object().prop('user', UserDTO)
        }
      }
    },
    async (req) => {
      return {
        user: req.ctx.user
      }
    }
  )
})
