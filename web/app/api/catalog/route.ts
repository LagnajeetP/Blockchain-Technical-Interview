import {
  COMMODITY_TERMS,
  ensureDemoCatalog,
  FAULT_LISTING_ID,
  PRIOR_LISTING_ID,
  publicSellerPlan,
  toPublicListing,
} from '@/lib/server/catalog';
import { publicChainInfo } from '@/lib/server/chain';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const listings = await ensureDemoCatalog();
    return Response.json(
      {
        listings: listings.map(toPublicListing),
        ownedListingIds: [PRIOR_LISTING_ID],
        protocolDrillListingId: FAULT_LISTING_ID,
        sellerAgent: publicSellerPlan(listings),
        marketTerms: COMMODITY_TERMS,
        chain: publicChainInfo(),
        disclosure:
          'Scores and case payloads stay in private object storage. Public fields are scope, age, price, provenance, terms, and commitment.',
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Catalog unavailable' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
