import { CardFactory } from 'botbuilder';
import type { Attachment } from 'botbuilder';
import type { Restaurant, RecommendationResult, VoteResult, SelectedHistory, RestaurantRepository, VoterEntry, WeatherInfo } from '../core/types.js';

// Top menu ActionSet - 모든 카드 상단에 공통으로 추가
function buildTopMenuActionSet(): any {
  return {
    type: 'ActionSet',
    actions: [
      {
        type: 'Action.Execute',
        verb: 'main_menu',
        title: '🏠 메뉴로',
        data: {},
      },
    ],
  };
}

// Main menu card - 날씨 표시 + 버튼 8개 (ActionSet 4+4)
export function buildMainMenuCard(weather?: WeatherInfo): Attachment {
  const body: any[] = [
    {
      type: 'TextBlock',
      text: '🍽️ MeaLOps',
      weight: 'bolder',
      size: 'large',
    },
  ];

  if (weather) {
    const weatherEmoji =
      weather.condition === 'rain'   ? '🌧️' :
      weather.condition === 'snow'   ? '❄️' :
      weather.condition === 'clouds' ? '☁️' : '☀️';
    body.push({
      type: 'TextBlock',
      text: `${weatherEmoji} ${weather.temp}°C, ${weather.description}`,
      wrap: true,
      spacing: 'small',
      isSubtle: true,
      size: 'small',
    });
  }

  // ActionSet 1: 4개 버튼
  body.push({
    type: 'ActionSet',
    actions: [
      { type: 'Action.Execute', verb: 'show_vote',    title: '🗳️ 투표하기',   data: {} },
      { type: 'Action.Execute', verb: 'recommend',    title: '🤖 AI 추천',    data: {} },
      { type: 'Action.Execute', verb: 'show_list',    title: '📋 식당목록',   data: {} },
      { type: 'Action.Execute', verb: 'my_favorites', title: '⭐ 내최애',     data: {} },
    ],
  });

  // ActionSet 2: 3개 버튼 (식당추가 제거)
  body.push({
    type: 'ActionSet',
    actions: [
      { type: 'Action.Execute', verb: 'my_blacklist',   title: '🚫 블랙리스트', data: {} },
      { type: 'Action.Execute', verb: 'show_settings',  title: '⚙️ 설정',      data: {} },
      { type: 'Action.Execute', verb: 'dashboard',      title: '📊 히스토리',  data: {} },
    ],
  });

  return CardFactory.adaptiveCard({
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.4',
    body,
  });
}

// Vote card - 투표 UI/UX 개선 (색상·강조 차별화)
export function buildVoteCard(
  restaurants: Restaurant[],
  voteResults: VoteResult[],
  soloCount: number,
  userVoteRestaurantIds?: number[],
  userIsSolo?: boolean,
  userIsAny?: boolean,
  votersByRestaurant?: Map<number, VoterEntry[]>,
  soloVoters?: VoterEntry[],
  anyVoters?: VoterEntry[],
  anyCount?: number,
  uniqueVoterCount?: number,
  deliveryMode?: boolean,
  globalBlacklistedIds?: number[]
): Attachment {
  const voteMap = new Map(voteResults.map(v => [v.restaurant_id, v.count]));
  const userVoteIds = new Set(userVoteRestaurantIds || []);
  const globalBlackSet = new Set(globalBlacklistedIds || []);

  const stats = `👥 ${uniqueVoterCount || 0}명 참여  ·  🍱 혼밥 ${soloCount}명  ·  🎲 아무거나 ${anyCount || 0}명`;
  const deliveryLabel = deliveryMode ? ' 🛵 배달모드' : '';

  const body: any[] = [
    buildTopMenuActionSet(),
    {
      type: 'TextBlock',
      text: `🍽️ 오늘 점심 뭐먹지?${deliveryLabel}`,
      weight: 'bolder',
      size: 'large',
    },
    {
      type: 'TextBlock',
      text: stats,
      wrap: true,
      spacing: 'small',
      isSubtle: true,
      size: 'small',
    },
  ];

  if (deliveryMode) {
    body.push({
      type: 'TextBlock',
      text: '🛵 오늘은 배달 메뉴입니다.',
      wrap: true,
      color: 'accent',
      spacing: 'small',
    });
  }

  for (const restaurant of restaurants) {
    const count = voteMap.get(restaurant.id) ?? 0;
    const isSelected = userVoteIds.has(restaurant.id);
    const isGlobalBlacklisted = globalBlackSet.has(restaurant.id);
    const voters = votersByRestaurant?.get(restaurant.id) || [];
    const voterNames = voters.map(v => v.user_name).join(', ');

    // Color priority: blacklisted > voted > default
    const textColor = isGlobalBlacklisted ? 'attention' : (isSelected ? 'good' : 'default');
    const countText = count > 0 ? ` (${count}표)` : '';
    const nameText = `${restaurant.name}${restaurant.alias ? ` · ${restaurant.alias}` : ''}${countText}`;

    body.push({
      type: 'ColumnSet',
      selectAction: {
        type: 'Action.Execute',
        verb: 'vote',
        data: { restaurantId: restaurant.id, restaurantName: restaurant.name },
      },
      columns: [
        {
          type: 'Column',
          width: 'stretch',
          items: [
            {
              type: 'TextBlock',
              text: nameText,
              weight: isSelected ? 'bolder' : 'default',
              color: textColor,
              wrap: true,
            },
            ...(isGlobalBlacklisted ? [{
              type: 'TextBlock',
              text: '⚠️ 누군가의 블랙리스트',
              size: 'small',
              color: 'attention',
              isSubtle: true,
              spacing: 'none',
            }] : []),
            ...(voterNames ? [{
              type: 'TextBlock',
              text: voterNames,
              size: 'small',
              isSubtle: true,
              wrap: true,
              spacing: 'none',
            }] : []),
          ],
        },
        {
          type: 'Column',
          width: 'auto',
          items: [
            {
              type: 'TextBlock',
              text: isSelected ? '✅' : '▶ 투표',
              horizontalAlignment: 'right',
              color: isSelected ? 'good' : 'accent',
              weight: 'bolder',
            },
          ],
        },
      ],
    });
  }

  // 혼밥 행
  body.push({
    type: 'ColumnSet',
    selectAction: {
      type: 'Action.Execute',
      verb: 'vote_solo',
      data: {},
    },
    columns: [
      {
        type: 'Column',
        width: 'stretch',
        items: [
          {
            type: 'TextBlock',
            text: `🍱 혼밥${soloCount > 0 ? ` (${soloCount}표)` : ''}`,
            weight: userIsSolo ? 'bolder' : 'default',
            color: userIsSolo ? 'good' : 'default',
            wrap: true,
          },
          ...(soloVoters && soloVoters.length > 0 ? [{
            type: 'TextBlock',
            text: soloVoters.map(v => v.user_name).join(', '),
            size: 'small',
            isSubtle: true,
            wrap: true,
            spacing: 'none',
          }] : []),
        ],
      },
      {
        type: 'Column',
        width: 'auto',
        items: [{
          type: 'TextBlock',
          text: userIsSolo ? '✅' : '▶ 투표',
          horizontalAlignment: 'right',
          color: userIsSolo ? 'good' : 'accent',
          weight: 'bolder',
        }],
      },
    ],
  });

  // 아무거나 행
  body.push({
    type: 'ColumnSet',
    selectAction: {
      type: 'Action.Execute',
      verb: 'vote_any',
      data: {},
    },
    columns: [
      {
        type: 'Column',
        width: 'stretch',
        items: [
          {
            type: 'TextBlock',
            text: `🎲 아무거나${(anyCount || 0) > 0 ? ` (${anyCount}표)` : ''}`,
            weight: userIsAny ? 'bolder' : 'default',
            color: userIsAny ? 'good' : 'default',
            wrap: true,
          },
          ...(anyVoters && anyVoters.length > 0 ? [{
            type: 'TextBlock',
            text: anyVoters.map(v => v.user_name).join(', '),
            size: 'small',
            isSubtle: true,
            wrap: true,
            spacing: 'none',
          }] : []),
        ],
      },
      {
        type: 'Column',
        width: 'auto',
        items: [{
          type: 'TextBlock',
          text: userIsAny ? '✅' : '▶ 투표',
          horizontalAlignment: 'right',
          color: userIsAny ? 'good' : 'accent',
          weight: 'bolder',
        }],
      },
    ],
  });

  return CardFactory.adaptiveCard({
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.4',
    body,
  });
}

// Recommendation card - 인라인 투표 버튼 + 새로고침 (블랙 버튼 제거)
export function buildRecommendCard(recommendations: RecommendationResult[]): Attachment {
  const body: any[] = [
    buildTopMenuActionSet(),
    {
      type: 'ActionSet',
      actions: [{
        type: 'Action.Execute',
        verb: 'refresh_recommend',
        title: '🔄 새로고침',
        data: {},
      }],
    },
    {
      type: 'TextBlock',
      text: '🤖 AI 추천 메뉴',
      weight: 'bolder',
      size: 'large',
    },
    ...recommendations.map((r, i) => ({
      type: 'ColumnSet',
      selectAction: {
        type: 'Action.Execute',
        verb: 'vote',
        data: { restaurantName: r.name },
      },
      columns: [
        {
          type: 'Column',
          width: 'stretch',
          items: [
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
              isSubtle: true,
              spacing: 'small',
              size: 'small',
            },
          ],
        },
        {
          type: 'Column',
          width: 'auto',
          items: [{
            type: 'TextBlock',
            text: '▶ 투표',
            horizontalAlignment: 'right',
            color: 'accent',
            weight: 'bolder',
          }],
        },
      ],
    })),
  ];

  return CardFactory.adaptiveCard({
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.4',
    body,
  });
}

// Review card
export function buildReviewCard(restaurantName: string): Attachment {
  return CardFactory.adaptiveCard({
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.4',
    body: [
      buildTopMenuActionSet(),
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
      { type: 'Action.Execute', verb: 'review', title: '⭐ 1점',     data: { restaurantName, rating: 1 } },
      { type: 'Action.Execute', verb: 'review', title: '⭐⭐ 2점',   data: { restaurantName, rating: 2 } },
      { type: 'Action.Execute', verb: 'review', title: '⭐⭐⭐ 3점', data: { restaurantName, rating: 3 } },
      { type: 'Action.Execute', verb: 'review', title: '⭐⭐⭐⭐ 4점',   data: { restaurantName, rating: 4 } },
      { type: 'Action.Execute', verb: 'review', title: '⭐⭐⭐⭐⭐ 5점', data: { restaurantName, rating: 5 } },
    ],
  });
}

// Response card
export function buildResponseCard(message: string, showBack?: boolean): Attachment {
  return CardFactory.adaptiveCard({
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.4',
    body: [{ type: 'TextBlock', text: message, wrap: true }],
    actions: showBack ? [{
      type: 'Action.Execute',
      verb: 'main_menu',
      title: '🏠 메뉴로',
      data: {},
    }] : [],
  });
}

// 식당 목록 한 행 (🚫 ✏️ 🗑️ 버튼 포함)
function buildRestaurantRow(r: Restaurant, userBlackSet: Set<number>, globalBlackSet: Set<number>): any {
  const isUserBlacklisted = userBlackSet.has(r.id);
  const isGlobalBlacklisted = globalBlackSet.has(r.id);
  const deliveryBadge = r.is_delivery ? ' 🛵' : '';
  const nameText = `${isUserBlacklisted ? '🚫 ' : ''}${r.name}${r.alias ? ` (${r.alias})` : ''}${deliveryBadge}`;
  const detailText = `${r.category} | ${r.distance}m | ₩${r.price.toLocaleString()}`;

  return {
    type: 'ColumnSet',
    columns: [
      {
        type: 'Column',
        width: 'stretch',
        items: [
          {
            type: 'TextBlock',
            text: nameText,
            weight: 'bolder',
            wrap: true,
            ...(isGlobalBlacklisted ? { color: 'attention' } : {}),
          },
          { type: 'TextBlock', text: detailText, size: 'small', isSubtle: true, spacing: 'none', wrap: true },
        ],
      },
      {
        type: 'Column',
        width: 'auto',
        items: [{ type: 'ActionSet', actions: [{ type: 'Action.Execute', verb: 'blacklist_toggle', title: isUserBlacklisted ? '🚫✓' : '🚫', data: { restaurantId: r.id, restaurantName: r.name } }] }],
      },
      {
        type: 'Column',
        width: 'auto',
        items: [{ type: 'ActionSet', actions: [{ type: 'Action.Execute', verb: 'edit_restaurant', title: '✏️', data: { restaurantId: r.id } }] }],
      },
      {
        type: 'Column',
        width: 'auto',
        items: [{ type: 'ActionSet', actions: [{ type: 'Action.Execute', verb: 'delete_restaurant', title: '🗑️', data: { restaurantId: r.id, restaurantName: r.name } }] }],
      },
    ],
  };
}

// List card - 정렬 버튼 + 각 행 인라인 버튼
export function buildListCard(
  restaurants: Restaurant[],
  blacklistedIds: number[] = [],
  sortBy: 'default' | 'name' | 'distance' | 'price' | 'category' = 'default',
  sortOrder: 'asc' | 'desc' = 'asc',
  userBlacklistedIds: number[] = []
): Attachment {
  const userBlackSet = new Set(userBlacklistedIds);
  const globalBlackSet = new Set(blacklistedIds);

  function sortLabel(btn: 'name' | 'distance' | 'price', base: string): string {
    if (sortBy === btn) return sortOrder === 'asc' ? `${base} ▲` : `${base} ▼`;
    return base;
  }
  function nextSort(btn: 'name' | 'distance' | 'price'): { sortBy: string; sortOrder: string } {
    if (sortBy === btn) {
      return sortOrder === 'asc' ? { sortBy: btn, sortOrder: 'desc' } : { sortBy: 'default', sortOrder: 'asc' };
    }
    return { sortBy: btn, sortOrder: 'asc' };
  }

  const body: any[] = [
    buildTopMenuActionSet(),
    {
      type: 'TextBlock',
      text: `🍽️ 식당 목록 (총 ${restaurants.length}개)`,
      weight: 'bolder',
      size: 'large',
    },
    {
      type: 'ActionSet',
      actions: [
        { type: 'Action.Execute', verb: 'sort_list', title: sortLabel('name', '가나다'),   data: nextSort('name') },
        { type: 'Action.Execute', verb: 'sort_list', title: sortLabel('distance', '거리'), data: nextSort('distance') },
        { type: 'Action.Execute', verb: 'sort_list', title: sortLabel('price', '가격'),    data: nextSort('price') },
        {
          type: 'Action.Execute', verb: 'sort_list',
          title: sortBy === 'category' ? '종류 ✓' : '종류',
          data: sortBy === 'category' ? { sortBy: 'default', sortOrder: 'asc' } : { sortBy: 'category', sortOrder: 'asc' },
        },
        { type: 'Action.Execute', verb: 'add_restaurant_form', title: '➕ 식당추가', data: {} },
      ],
    },
  ];

  // 카테고리별 보기
  if (sortBy === 'category') {
    const grouped = restaurants.reduce((acc, r) => {
      if (!acc[r.category]) acc[r.category] = [];
      acc[r.category].push(r);
      return acc;
    }, {} as Record<string, Restaurant[]>);

    const categoryOrder = ['한식', '중식', '일식', '양식', '분식', '기타'];
    const sortedCategories = categoryOrder.filter(c => grouped[c]);
    // 혹시 모르는 카테고리도 포함
    Object.keys(grouped).forEach(c => { if (!sortedCategories.includes(c)) sortedCategories.push(c); });

    for (const category of sortedCategories) {
      body.push({
        type: 'TextBlock',
        text: `**${category}** (${grouped[category].length}개)`,
        weight: 'bolder',
        spacing: 'medium',
        color: 'accent',
      });
      const catSorted = [...grouped[category]].sort((a, b) => a.name.localeCompare(b.name, 'ko'));
      for (const r of catSorted) {
        body.push(buildRestaurantRow(r, userBlackSet, globalBlackSet));
      }
    }

    if (restaurants.length === 0) {
      body.push({ type: 'TextBlock', text: '등록된 식당이 없습니다.', isSubtle: true, wrap: true });
    }

    return CardFactory.adaptiveCard({
      $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
      type: 'AdaptiveCard',
      version: '1.4',
      body,
    });
  }

  // 일반 정렬
  let sorted: Restaurant[];
  switch (sortBy) {
    case 'name':     sorted = [...restaurants].sort((a, b) => a.name.localeCompare(b.name, 'ko')); break;
    case 'distance': sorted = [...restaurants].sort((a, b) => a.distance - b.distance); break;
    case 'price':    sorted = [...restaurants].sort((a, b) => a.price - b.price); break;
    default:         sorted = [...restaurants].sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  }
  if (sortOrder === 'desc') sorted = sorted.reverse();

  for (const r of sorted) {
    body.push(buildRestaurantRow(r, userBlackSet, globalBlackSet));
  }

  if (sorted.length === 0) {
    body.push({ type: 'TextBlock', text: '등록된 식당이 없습니다.', isSubtle: true, wrap: true });
  }

  return CardFactory.adaptiveCard({
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.4',
    body,
  });
}

// Edit restaurant card - 별명 필드 포함
export function buildEditRestaurantCard(restaurant: Restaurant): Attachment {
  return CardFactory.adaptiveCard({
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.4',
    body: [
      buildTopMenuActionSet(),
      { type: 'TextBlock', text: `✏️ 식당 수정: ${restaurant.name}`, weight: 'bolder', size: 'large' },
      { type: 'TextBlock', text: '식당명', weight: 'bolder', spacing: 'medium' },
      { type: 'Input.Text', id: 'name', value: restaurant.name, placeholder: '식당 이름' },
      { type: 'TextBlock', text: '별명 (선택사항)', weight: 'bolder', spacing: 'small' },
      { type: 'Input.Text', id: 'alias', value: restaurant.alias ?? '', placeholder: '예: 2층식당, 된장찌개집' },
      { type: 'TextBlock', text: '카테고리', weight: 'bolder', spacing: 'small' },
      {
        type: 'Input.ChoiceSet',
        id: 'category',
        value: restaurant.category,
        choices: [
          { title: '한식', value: '한식' }, { title: '중식', value: '중식' },
          { title: '일식', value: '일식' }, { title: '양식', value: '양식' },
          { title: '분식', value: '분식' }, { title: '기타', value: '기타' },
        ],
      },
      { type: 'TextBlock', text: '거리 (m)', weight: 'bolder', spacing: 'small' },
      { type: 'Input.Text', id: 'distance', value: String(restaurant.distance), placeholder: '거리 (미터)' },
      { type: 'TextBlock', text: '가격 (₩)', weight: 'bolder', spacing: 'small' },
      { type: 'Input.Text', id: 'price', value: String(restaurant.price), placeholder: '가격' },
      {
        type: 'Input.Toggle',
        id: 'is_delivery',
        title: '🛵 배달 가능',
        value: restaurant.is_delivery ? 'true' : 'false',
        valueOn: 'true',
        valueOff: 'false',
        spacing: 'small',
      },
    ],
    actions: [
      { type: 'Action.Execute', verb: 'save_restaurant',  title: '✅ 저장', associatedInputs: 'auto', data: { restaurantId: restaurant.id } },
      { type: 'Action.Execute', verb: 'cancel_edit',      title: '❌ 취소', data: {} },
    ],
  });
}

// Add restaurant card - 별명 필드 포함
export function buildAddRestaurantCard(): Attachment {
  return CardFactory.adaptiveCard({
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.4',
    body: [
      buildTopMenuActionSet(),
      { type: 'TextBlock', text: '➕ 식당 추가', weight: 'bolder', size: 'large' },
      { type: 'TextBlock', text: '식당명', weight: 'bolder', spacing: 'medium' },
      { type: 'Input.Text', id: 'name', placeholder: '식당 이름' },
      { type: 'TextBlock', text: '별명 (선택사항)', weight: 'bolder', spacing: 'small' },
      { type: 'Input.Text', id: 'alias', placeholder: '예: 2층식당, 된장찌개집' },
      { type: 'TextBlock', text: '카테고리', weight: 'bolder', spacing: 'small' },
      {
        type: 'Input.ChoiceSet',
        id: 'category',
        value: '한식',
        choices: [
          { title: '한식', value: '한식' }, { title: '중식', value: '중식' },
          { title: '일식', value: '일식' }, { title: '양식', value: '양식' },
          { title: '분식', value: '분식' }, { title: '기타', value: '기타' },
        ],
      },
      { type: 'TextBlock', text: '거리 (m)', weight: 'bolder', spacing: 'small' },
      { type: 'Input.Text', id: 'distance', placeholder: '거리 (미터)' },
      { type: 'TextBlock', text: '가격 (₩)', weight: 'bolder', spacing: 'small' },
      { type: 'Input.Text', id: 'price', placeholder: '가격' },
      {
        type: 'Input.Toggle',
        id: 'is_delivery',
        title: '🛵 배달 가능',
        value: 'false',
        valueOn: 'true',
        valueOff: 'false',
        spacing: 'small',
      },
    ],
    actions: [
      { type: 'Action.Execute', verb: 'create_restaurant', title: '➕ 추가',   associatedInputs: 'auto', data: {} },
      { type: 'Action.Execute', verb: 'show_list',         title: '❌ 취소',   data: {} },
    ],
  });
}

// Blacklist card
export function buildBlacklistCard(restaurants: Restaurant[]): Attachment {
  if (restaurants.length === 0) {
    return buildResponseCard('블랙리스트가 비어있습니다.', true);
  }

  const body: any[] = [
    buildTopMenuActionSet(),
    { type: 'TextBlock', text: '🚫 내 블랙리스트', weight: 'bolder', size: 'large' },
  ];

  for (const r of restaurants) {
    body.push({
      type: 'ColumnSet',
      selectAction: {
        type: 'Action.Execute',
        verb: 'blacklist_remove',
        data: { restaurantId: r.id, restaurantName: r.name },
      },
      columns: [
        {
          type: 'Column',
          width: 'stretch',
          items: [{
            type: 'TextBlock',
            text: `${r.name}${r.alias ? ` (${r.alias})` : ''} | ${r.category} | ${r.distance}m`,
            wrap: true,
          }],
        },
        {
          type: 'Column',
          width: 'auto',
          items: [{ type: 'TextBlock', text: '🗑️', horizontalAlignment: 'right' }],
        },
      ],
    });
  }

  body.push({
    type: 'TextBlock',
    text: '(항목을 클릭하면 블랙리스트에서 제거됩니다)',
    wrap: true,
    isSubtle: true,
    spacing: 'medium',
  });

  return CardFactory.adaptiveCard({
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.4',
    body,
  });
}

// Settings card - 식대 수정 + 강제결정/배달 단일 토글 버튼 + 하단 메뉴버튼 제거
export function buildSettingsCard(budget: number, forceEnabled: boolean, deliveryModeActive: boolean = false): Attachment {
  return CardFactory.adaptiveCard({
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.4',
    body: [
      buildTopMenuActionSet(),
      { type: 'TextBlock', text: '⚙️ 설정', weight: 'bolder', size: 'large' },
      {
        type: 'TextBlock',
        text: `📊 1인 식대: ₩${budget.toLocaleString()}`,
        wrap: true,
        spacing: 'medium',
        weight: 'bolder',
      },
      {
        type: 'Input.Text',
        id: 'budget',
        value: String(budget),
        placeholder: '식대 금액 입력',
        spacing: 'small',
      },
      {
        type: 'TextBlock',
        text: `🔔 강제결정: ${forceEnabled ? 'ON ✅' : 'OFF'}`,
        wrap: true,
        spacing: 'medium',
        ...(forceEnabled ? { color: 'good' } : { isSubtle: true }),
      },
      {
        type: 'TextBlock',
        text: `🛵 배달 모드: ${deliveryModeActive ? 'ON ✅' : 'OFF'}`,
        wrap: true,
        spacing: 'small',
        ...(deliveryModeActive ? { color: 'accent' } : { isSubtle: true }),
      },
    ],
    actions: [
      {
        type: 'Action.Execute',
        verb: 'set_budget',
        title: '💰 식대 저장',
        associatedInputs: 'auto',
        data: {},
      },
      {
        type: 'Action.Execute',
        verb: 'toggle_force_decision',
        title: forceEnabled ? '🔕 강제결정 끄기' : '🔔 강제결정 켜기',
        associatedInputs: 'none',
        data: {},
      },
      {
        type: 'Action.Execute',
        verb: 'toggle_delivery_setting',
        title: deliveryModeActive ? '🛵 배달 모드 끄기' : '🛵 배달 모드 켜기',
        associatedInputs: 'none',
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
    buildTopMenuActionSet(),
    { type: 'TextBlock', text: '📊 최근 7일 점심 히스토리', weight: 'bolder', size: 'large' },
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
  });
}
