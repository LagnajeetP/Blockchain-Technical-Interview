import { env } from 'cloudflare:workers';
import {
  ensureDemoCatalog,
  FAULT_LISTING_ID,
  SUCCESS_LISTING_ID,
  toPublicListing,
} from '@/lib/server/catalog';
import {
  assertLiveConfiguration,
  broadcastPrepared,
  chainActors,
  confirmEvent,
  liveChainEnabled,
  prepareCreateListing,
} from '@/lib/server/chain';
import {
  getTransactionIntent,
  insertTransactionIntent,
  recordEventReceipt,
  updateTransactionIntent,
  upsertListing,
} from '@/lib/server/db';

export const dynamic = 'force-dynamic';

function authorized(request: Request) {
  const header = request.headers.get('authorization');
  return Boolean(
    env.OPERATOR_TOKEN && header === `Bearer ${env.OPERATOR_TOKEN}`,
  );
}

export async function POST(request: Request) {
  if (!authorized(request))
    return Response.json(
      { error: 'Operator authorization required' },
      { status: 401 },
    );
  if (!liveChainEnabled()) {
    return Response.json(
      {
        error:
          'Live Base Sepolia configuration must be complete and explicitly enabled before seeding',
      },
      { status: 503 },
    );
  }
  try {
    await assertLiveConfiguration();
    const actors = chainActors();
    const listings = await ensureDemoCatalog();
    const transactions: Array<{ listingId: string; hash: string }> = [];
    for (const listing of listings.filter((item) =>
      [SUCCESS_LISTING_ID, FAULT_LISTING_ID].includes(item.id),
    )) {
      if (listing.contractListingId) continue;
      const intentId = `seed:${listing.id}:${listing.commitment}`;
      let intent = await getTransactionIntent(intentId);
      if (!intent) {
        const prepared = await prepareCreateListing(
          listing.commitment as `0x${string}`,
          listing.termsHash,
          listing.priceWei,
          BigInt(Math.floor(listing.expiresAt / 1000)),
        );
        const timestamp = Date.now();
        await insertTransactionIntent({
          id: intentId,
          scopeId: listing.id,
          action: 'Seed listing',
          transactionHash: prepared.hash,
          signedTransaction: prepared.serializedTransaction,
          status: 'prepared',
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        intent = await getTransactionIntent(intentId);
      }
      if (!intent)
        throw new Error(`Unable to persist seed intent for ${listing.id}`);
      if (intent.status === 'prepared') {
        if (!intent.signedTransaction)
          throw new Error(`Seed payload missing for ${listing.id}`);
        try {
          await broadcastPrepared(intent.signedTransaction);
        } catch (error) {
          if (
            !/already known|nonce too low/i.test(
              error instanceof Error ? error.message : String(error),
            )
          ) {
            throw error;
          }
        }
        await updateTransactionIntent(intentId, 'broadcast');
      }
      const event = await confirmEvent(
        intent.transactionHash,
        'ListingCreated',
        actors.operator,
      );
      if (
        String(event.args.seller).toLowerCase() !==
          actors.operator.toLowerCase() ||
        String(event.args.evaluator).toLowerCase() !==
          actors.evaluator.toLowerCase() ||
        event.args.artifactCommitment !== listing.commitment ||
        event.args.termsHash !== listing.termsHash ||
        BigInt(String(event.args.price)) !== listing.priceWei ||
        BigInt(String(event.args.expiresAt)) !==
          BigInt(Math.floor(listing.expiresAt / 1000))
      ) {
        throw new Error(`On-chain listing receipt mismatch for ${listing.id}`);
      }
      listing.contractListingId = String(event.args.listingId);
      await recordEventReceipt(
        84532,
        event.hash,
        event.logIndex,
        event.eventName,
      );
      await updateTransactionIntent(intentId, 'confirmed');
      await upsertListing(listing);
      transactions.push({
        listingId: listing.id,
        hash: intent.transactionHash,
      });
    }
    return Response.json(
      { listings: listings.map(toPublicListing), transactions },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : 'Unable to seed catalog',
      },
      { status: 500 },
    );
  }
}
