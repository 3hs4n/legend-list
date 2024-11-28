import { type StateContext, peek$ } from './state';
import type {
    InternalState,
    LegendListProps,
    ViewToken,
    ViewabilityAmountCallback,
    ViewabilityCallback,
    ViewabilityConfig,
    ViewabilityConfigCallbackPair,
} from './types';

const mapViewabilityConfigCallbackPairs = new Map<
    string,
    {
        viewableItems: ViewToken[];
        start: number;
        end: number;
        previousStart: number;
        previousEnd: number;
    }
>();
const mapViewabilityCallbacks = new Map<string, ViewabilityCallback>();
const mapViewabilityAmountCallbacks = new Map<string, ViewabilityAmountCallback>();

export function setupViewability(props: LegendListProps<any>) {
    let { viewabilityConfig, viewabilityConfigCallbackPairs, onViewableItemsChanged } = props;

    viewabilityConfigCallbackPairs = viewabilityConfigCallbackPairs! || [
        { viewabilityConfig: viewabilityConfig || { viewAreaCoveragePercentThreshold: 0 }, onViewableItemsChanged },
    ];

    if (viewabilityConfigCallbackPairs) {
        for (const pair of viewabilityConfigCallbackPairs) {
            mapViewabilityConfigCallbackPairs.set(pair.viewabilityConfig.id, {
                viewableItems: [],
                start: -1,
                end: -1,
                previousStart: -1,
                previousEnd: -1,
            });
        }
    }
    return viewabilityConfigCallbackPairs;
}

export function updateViewableItems(
    state: InternalState,
    ctx: StateContext,
    viewabilityConfigCallbackPairs: ViewabilityConfigCallbackPair[],
    getId: (index: number) => string,
    scrollSize: number,
    start: number,
    end: number,
) {
    for (const viewabilityConfigCallbackPair of viewabilityConfigCallbackPairs) {
        const viewabilityState = mapViewabilityConfigCallbackPairs.get(
            viewabilityConfigCallbackPair.viewabilityConfig.id,
        )!;
        viewabilityState.start = start;
        viewabilityState.end = end;
        if (viewabilityConfigCallbackPair.viewabilityConfig.minimumViewTime) {
            const timer: any = setTimeout(() => {
                state.timeouts.delete(timer);
                updateViewableItemsWithConfig(state.data, viewabilityConfigCallbackPair, getId, state, ctx, scrollSize);
            }, viewabilityConfigCallbackPair.viewabilityConfig.minimumViewTime);
            state.timeouts.add(timer);
        } else {
            updateViewableItemsWithConfig(state.data, viewabilityConfigCallbackPair, getId, state, ctx, scrollSize);
        }
    }
}

function updateViewableItemsWithConfig(
    data: any[],
    viewabilityConfigCallbackPair: ViewabilityConfigCallbackPair,
    getId: (index: number) => string,
    state: InternalState,
    ctx: StateContext,
    scrollSize: number,
) {
    const { viewabilityConfig, onViewableItemsChanged } = viewabilityConfigCallbackPair;
    const configId = viewabilityConfig.id;
    const viewabilityState = mapViewabilityConfigCallbackPairs.get(configId)!;
    const { viewableItems: previousViewableItems, start, previousStart, end, previousEnd } = viewabilityState;
    // if (previousStart === start && previousEnd === end) {
    //     // Already processed this, so skip it
    //     return;
    // }
    const changed: ViewToken[] = [];
    if (previousViewableItems) {
        for (const viewToken of previousViewableItems) {
            if (
                !isViewable(state, ctx, viewabilityConfig, viewToken.key, scrollSize, viewToken.item, viewToken.index)
            ) {
                viewToken.isViewable = false;
                changed.push(viewToken);
            }
        }
    }

    const viewableItems: ViewToken[] = [];

    for (let i = start; i <= end; i++) {
        const item = data[i];
        if (item) {
            const key = getId(i);
            if (isViewable(state, ctx, viewabilityConfig, key, scrollSize, item, i)) {
                const viewToken: ViewToken = {
                    item,
                    key,
                    index: i,
                    isViewable: true,
                };
                viewableItems.push(viewToken);
                if (!previousViewableItems?.find((v) => v.key === viewToken.key)) {
                    changed.push(viewToken);
                }
            }
        }
    }

    Object.assign(viewabilityState, { viewableItems, previousStart: start, previousEnd: end });

    if (changed.length > 0) {
        viewabilityState.viewableItems = viewableItems;

        for (let i = 0; i < changed.length; i++) {
            const change = changed[i];
            maybeUpdateViewabilityCallback(configId, change);
        }

        if (onViewableItemsChanged) {
            onViewableItemsChanged({ viewableItems, changed });
        }
    }
}

function isViewable(
    state: InternalState,
    ctx: StateContext,
    viewabilityConfig: ViewabilityConfig,
    key: string,
    scrollSize: number,
    item: any,
    index: number,
) {
    const { sizes, positions, scroll } = state;
    const topPad = (peek$(ctx, 'stylePaddingTop') || 0) + (peek$(ctx, 'headerSize') || 0);
    const { itemVisiblePercentThreshold, viewAreaCoveragePercentThreshold } = viewabilityConfig;
    const viewAreaMode = viewAreaCoveragePercentThreshold != null;
    const viewablePercentThreshold = viewAreaMode ? viewAreaCoveragePercentThreshold : itemVisiblePercentThreshold;
    const top = positions.get(key)! - scroll + topPad;
    const size = sizes.get(key)! || 0;
    const bottom = top + size;
    const isEntirelyVisible = top >= 0 && bottom <= scrollSize && bottom > top;

    const visibleHeight = isEntirelyVisible ? size : Math.min(bottom, scrollSize) - Math.max(top, 0);
    const percentVisible = isEntirelyVisible ? 100 : 100 * (visibleHeight / size);
    const percent = isEntirelyVisible ? 100 : 100 * (visibleHeight / (viewAreaMode ? scrollSize : size));

    const isViewable = percent >= viewablePercentThreshold!;

    // TODO: This would run for each viewabilityConfig, maybe move it elsewhere?
    const cb = mapViewabilityAmountCallbacks.get(key);
    if (cb) {
        cb({
            index,
            isViewable,
            item,
            key,
            percentVisible: percentVisible,
            sizeVisible: visibleHeight,
        });
    }

    return isViewable!;
}

function maybeUpdateViewabilityCallback(configId: string, viewToken: ViewToken) {
    const key = viewToken.key + configId;

    const cb = mapViewabilityCallbacks.get(key);

    cb?.(viewToken);
}

export function registerViewabilityCallback(itemKey: string, configId: string, callback: ViewabilityCallback) {
    const key = itemKey + configId;

    mapViewabilityCallbacks.set(key, callback);

    return () => {
        mapViewabilityCallbacks.delete(key);
    };
}

export function registerViewabilityAmountCallback(itemKey: string, callback: ViewabilityAmountCallback) {
    mapViewabilityAmountCallbacks.set(itemKey, callback);

    return () => {
        mapViewabilityAmountCallbacks.delete(itemKey);
    };
}
