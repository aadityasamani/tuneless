# @tuneless/core

Shared logic shared between the desktop and mobile versions of Tuneless.

## Contents

| File | Purpose |
|------|---------|
| `utils/scoring.ts` | YouTube title scoring — picks best match from search results (full audio > official > lyrics > penalized) |
| `utils/shuffle.ts` | Fisher-Yates shuffle with same-artist spreading — avoids back-to-back duplicates |
| `utils/formatting.ts` | Duration (ISO → human), seconds formatting, HTML escaping, async wait |
| `types.ts` | All shared TypeScript types |
| `services/keyRouter.ts` | Multi-key adaptive router — manages multiple YouTube API keys with auto failover |

## Usage

```typescript
import { scoreTitle } from '@tuneless/core/utils/scoring';
import { buildShuffleOrder } from '@tuneless/core/utils/shuffle';
import { formatDuration } from '@tuneless/core/utils/formatting';
import { keyRouter } from '@tuneless/core/services/keyRouter';
import type { Track, Playlist, RepeatMode } from '@tuneless/core/types';
```

This package has zero dependencies and no UI code — works in any JS environment.
