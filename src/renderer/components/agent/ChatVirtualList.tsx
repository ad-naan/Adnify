import { forwardRef, memo, useState } from 'react'
import { Virtuoso, type VirtuosoHandle, type VirtuosoProps, type FlatIndexLocationWithAlign } from 'react-virtuoso'

const HISTORY_LOCATION: FlatIndexLocationWithAlign = { index: 'LAST', align: 'end' }

/** Mount a new turn together; probing only its last row can hide the user message. */
export const ChatVirtualList = memo(forwardRef<VirtuosoHandle, VirtuosoProps<unknown, unknown>>((props, ref) => {
  const [initial] = useState(() => {
    const count = props.data?.length ?? props.totalCount ?? 0
    return count <= 2
      ? { location: 0, count }
      : { location: HISTORY_LOCATION, count: 0 }
  })
  return <Virtuoso {...props} ref={ref} initialTopMostItemIndex={initial.location} initialItemCount={initial.count} />
})) as typeof Virtuoso
