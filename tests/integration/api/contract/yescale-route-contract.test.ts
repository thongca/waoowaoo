import { describe, expect, it } from 'vitest'
import { ROUTE_CATALOG, type RouteCatalogEntry } from '../../../contracts/route-catalog'

describe('api contract - yescale route coverage', () => {
  it('keeps the updated direct-submit routes in the route catalog', () => {
    const routeFiles = new Set(ROUTE_CATALOG.map((entry: RouteCatalogEntry) => entry.routeFile))

    expect(routeFiles.has('src/app/api/asset-hub/voice-design/route.ts')).toBe(true)
    expect(routeFiles.has('src/app/api/novel-promotion/[projectId]/voice-design/route.ts')).toBe(true)
    expect(routeFiles.has('src/app/api/novel-promotion/[projectId]/voice-generate/route.ts')).toBe(true)
    expect(routeFiles.has('src/app/api/user/api-config/route.ts')).toBe(true)
    expect(routeFiles.has('src/app/api/user/models/route.ts')).toBe(true)
  })
})