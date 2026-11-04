import { Fragment, useLayoutEffect, type ReactNode } from 'react'
import { Virtuoso } from 'react-virtuoso'

const pendingMeasurements = new WeakSet<HTMLElement>()

/** Share the panel's scrollbar so each section does not introduce a nested scroller. */
export function GitFileList<T>({ items, getKey, renderItem, scrollParent }: {
    items: readonly T[]
    getKey: (item: T) => string
    renderItem: (item: T) => ReactNode
    scrollParent: HTMLElement | null
}) {
    useLayoutEffect(() => {
        if (!scrollParent || pendingMeasurements.has(scrollParent)) return
        // Collapsing an earlier section moves this list without resizing its
        // viewport. Notify Virtuoso's external-scroll measurement after layout;
        // coalesce all sections into one measurement, without changing scrollTop.
        pendingMeasurements.add(scrollParent)
        requestAnimationFrame(() => {
            pendingMeasurements.delete(scrollParent)
            if (scrollParent.isConnected) scrollParent.dispatchEvent(new Event('scroll'))
        })
    })
    if (items.length < 80) {
        return <>{items.map(item => <Fragment key={getKey(item)}>{renderItem(item)}</Fragment>)}</>
    }
    // The parent's ref is populated after the first commit. Do not briefly mount
    // thousands of rows while waiting for it.
    if (!scrollParent) return null
    return <Virtuoso
        data={items}
        customScrollParent={scrollParent}
        defaultItemHeight={48}
        increaseViewportBy={200}
        computeItemKey={(_index, item) => getKey(item)}
        itemContent={(_index, item) => <div className="flow-root">{renderItem(item)}</div>}
    />
}
