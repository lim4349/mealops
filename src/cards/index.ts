import { CardFactory } from 'botbuilder';
import type { Attachment } from 'botbuilder';
import type { Restaurant, RecommendationResult, VoteResult, SelectedHistory, RestaurantRepository } from '../core/types.js';

// Main menu card - 주요 기능 버튼들
export function buildMainMenuCard(): Attachment {
  return CardFactory.adaptiveCard({
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.4',
    body: [
      {
        type: 'TextBlock',
        text: '🍽️ MeaLOps',
        weight: 'bolder',
        size: 'large',
      },
      {
        type: 'TextBlock',
        text: '점심 메뉴 선정을 도와드립니다',
        wrap: true,
        spacing: 'small',
      },
    ],
    actions: [
      {
        type: 'Action.Execute',
        verb: 'show_vote',
        title: '🗳️ 투표하기',
        data: {},
      },
      {
        type: 'Action.Execute',
        verb: 'recommend',
        title: '🤖 AI 추천',
        data: {},
      },
      {
        type: 'Action.Execute',
        verb: 'show_list',
        title: '📋 식당목록',
        data: {},
      },
      {
        type: 'Action.Execute',
        verb: 'my_favorites',
        title: '⭐ 내최애',
        data: {},
      },
      {
        type: 'Action.Execute',
        verb: 'my_blacklist',
        title: '🚫 블랙리스트',
        data: {},
      },
      {
        type: 'Action.Execute',
        verb: 'show_settings',
        title: '⚙️ 설정',
        data: {},
      },
      {
        type: 'Action.Execute',
        verb: 'dashboard',
        title: '📊 히스토리',
        data: {},
      },
      {
        type: 'Action.Execute',
        verb: 'delivery',
        title: '🛵 배달주문',
        data: {},
      },
    ],
  });
}

// Vote card - 식당별 투표 버튼 + 혼밥 옵션
export function buildVoteCard(
  restaurants: Restaurant[],
  voteResults: VoteResult[],
  soloCount: number,
  userVoteRestaurantId?: number | null,
  userIsSolo?: boolean
): Attachment {
  const voteMap = new Map(voteResults.map(v => [v.restaurant_id, v.count]));

  const actions: any[] = restaurants.map(r => ({
    type: 'Action.Execute',
    verb: 'vote',
    title: `${userVoteRestaurantId === r.id ? '✅ ' : ''}${r.name} (${voteMap.get(r.id) ?? 0})`,
    data: { restaurantId: r.id, restaurantName: r.name },
  }));

  // Add solo vote button
  actions.push({
    type: 'Action.Execute',
    verb: 'vote_solo',
    title: `${userIsSolo ? '✅ ' : ''}🍱 오늘혼밥 (${soloCount})`,
    data: {} as any,
  });

  return CardFactory.adaptiveCard({
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.4',
    body: [
      {
        type: 'TextBlock',
        text: '🍽️ 오늘 점심 뭐먹지?',
        weight: 'bolder',
        size: 'large',
      },
      {
        type: 'TextBlock',
        text: '투표해주세요!',
        wrap: true,
        spacing: 'small',
      },
    ],
    actions,
  });
}

// Recommendation card - AI 추천 + 투표/블랙 버튼
export function buildRecommendCard(
  recommendations: RecommendationResult[]
): Attachment {
  return CardFactory.adaptiveCard({
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.4',
    body: [
      {
        type: 'TextBlock',
        text: '🤖 AI 추천 메뉴',
        weight: 'bolder',
        size: 'large',
      },
      ...recommendations.flatMap((r, i) => [
        {
          type: 'TextBlock',
          text: `${i + 1}. **${r.name}**`,
          weight: 'bolder',
          wrap: true,
        },
        {
          type: 'TextBlock',
          text: r.reason,
          wrap: true,
          spacing: 'small',
          isSubtle: true,
        },
        {
          type: 'ActionSet',
          actions: [
            {
              type: 'Action.Execute',
              verb: 'vote',
              title: '✅ 이걸로 투표!',
              data: { restaurantName: r.name },
            },
            {
              type: 'Action.Execute',
              verb: 'blacklist_add',
              title: '🚫 블랙',
              data: { restaurantName: r.name },
            },
          ],
        },
      ]),
    ],
  });
}

// Review card - 별점 버튼들
export function buildReviewCard(restaurantName: string): Attachment {
  return CardFactory.adaptiveCard({
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.4',
    body: [
      {
        type: 'TextBlock',
        text: '⭐ 식사 리뷰',
        weight: 'bolder',
        size: 'large',
      },
      {
        type: 'TextBlock',
        text: `${restaurantName}의 평점을 매겨주세요!`,
        wrap: true,
      },
    ],
    actions: [
      {
        type: 'Action.Execute',
        verb: 'review',
        title: '⭐ 1점',
        data: { restaurantName, rating: 1 },
      },
      {
        type: 'Action.Execute',
        verb: 'review',
        title: '⭐⭐ 2점',
        data: { restaurantName, rating: 2 },
      },
      {
        type: 'Action.Execute',
        verb: 'review',
        title: '⭐⭐⭐ 3점',
        data: { restaurantName, rating: 3 },
      },
      {
        type: 'Action.Execute',
        verb: 'review',
        title: '⭐⭐⭐⭐ 4점',
        data: { restaurantName, rating: 4 },
      },
      {
        type: 'Action.Execute',
        verb: 'review',
        title: '⭐⭐⭐⭐⭐ 5점',
        data: { restaurantName, rating: 5 },
      },
    ],
  });
}

// Response/confirmation card
export function buildResponseCard(message: string, showBack?: boolean): Attachment {
  const actions = [];
  if (showBack) {
    actions.push({
      type: 'Action.Execute',
      verb: 'main_menu',
      title: '🏠 메뉴로',
      data: {},
    });
  }

  return CardFactory.adaptiveCard({
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.4',
    body: [
      {
        type: 'TextBlock',
        text: message,
        wrap: true,
      },
    ],
    actions,
  });
}

// List card - 식당 목록
export function buildListCard(restaurants: Restaurant[]): Attachment {
  const grouped = restaurants.reduce((acc, r) => {
    if (!acc[r.category]) acc[r.category] = [];
    acc[r.category].push(r);
    return acc;
  }, {} as Record<string, Restaurant[]>);

  const body: any[] = [
    {
      type: 'TextBlock',
      text: `🍽️ 식당 목록 (총 ${restaurants.length}개)`,
      weight: 'bolder',
      size: 'large',
    },
  ];

  for (const [category, rests] of Object.entries(grouped)) {
    body.push({
      type: 'TextBlock',
      text: `**${category}**`,
      weight: 'bolder',
      spacing: 'medium',
    });

    for (const r of rests) {
      body.push({
        type: 'TextBlock',
        text: `• ${r.name} (${r.distance}m, ₩${r.price})`,
        wrap: true,
      });
    }
  }

  return CardFactory.adaptiveCard({
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.4',
    body,
    actions: [
      {
        type: 'Action.Execute',
        verb: 'main_menu',
        title: '🏠 메뉴로',
        data: {},
      },
    ],
  });
}

// Blacklist card - 각 항목에 제거 버튼
export function buildBlacklistCard(restaurants: Restaurant[]): Attachment {
  if (restaurants.length === 0) {
    return buildResponseCard('블랙리스트가 비어있습니다.', true);
  }

  const body: any[] = [
    {
      type: 'TextBlock',
      text: '🚫 내 블랙리스트',
      weight: 'bolder',
      size: 'large',
    },
  ];

  for (const r of restaurants) {
    body.push({
      type: 'ActionSet',
      actions: [
        {
          type: 'Action.Execute',
          verb: 'blacklist_remove',
          title: `${r.name} [제거]`,
          data: { restaurantId: r.id, restaurantName: r.name },
        },
      ],
    });
  }

  body.push({
    type: 'TextBlock',
    text: '(위 항목을 클릭하면 블랙리스트에서 제거됩니다)',
    wrap: true,
    isSubtle: true,
    spacing: 'medium',
  });

  return CardFactory.adaptiveCard({
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.4',
    body,
    actions: [
      {
        type: 'Action.Execute',
        verb: 'main_menu',
        title: '🏠 메뉴로',
        data: {},
      },
    ],
  });
}

// Settings card - 예산, 강제결정 토글
export function buildSettingsCard(budget: number, forceEnabled: boolean): Attachment {
  return CardFactory.adaptiveCard({
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.4',
    body: [
      {
        type: 'TextBlock',
        text: '⚙️ 설정',
        weight: 'bolder',
        size: 'large',
      },
      {
        type: 'TextBlock',
        text: `📊 1인 식대: ₩${budget}`,
        wrap: true,
        spacing: 'medium',
      },
      {
        type: 'TextBlock',
        text: `🔔 강제결정: ${forceEnabled ? 'ON' : 'OFF'}`,
        wrap: true,
      },
    ],
    actions: [
      {
        type: 'Action.Execute',
        verb: 'set_force_on',
        title: '강제결정 ON',
        data: {},
      },
      {
        type: 'Action.Execute',
        verb: 'set_force_off',
        title: '강제결정 OFF',
        data: {},
      },
      {
        type: 'Action.Execute',
        verb: 'main_menu',
        title: '🏠 메뉴로',
        data: {},
      },
    ],
  });
}

// Dashboard/History card
export function buildDashboardCard(
  history: SelectedHistory[],
  restaurantRepo: RestaurantRepository
): Attachment {
  if (history.length === 0) {
    return buildResponseCard('아직 히스토리가 없습니다.', true);
  }

  const body: any[] = [
    {
      type: 'TextBlock',
      text: '📊 최근 7일 점심 히스토리',
      weight: 'bolder',
      size: 'large',
    },
  ];

  for (const h of history) {
    const restaurant = restaurantRepo.findById(h.restaurant_id);
    body.push({
      type: 'TextBlock',
      text: `• ${h.selected_date}: ${restaurant?.name ?? '알 수 없음'} (${h.vote_count}표)`,
      wrap: true,
    });
  }

  return CardFactory.adaptiveCard({
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.4',
    body,
    actions: [
      {
        type: 'Action.Execute',
        verb: 'main_menu',
        title: '🏠 메뉴로',
        data: {},
      },
    ],
  });
}
