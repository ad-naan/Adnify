import type { ImgHTMLAttributes } from 'react'
import { otterAssetSrc, type OtterAssetKey } from './otterAssets'

type OtterAssetProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> & {
  asset: OtterAssetKey
}

export function OtterAsset({ asset, alt = '', className = '', draggable = false, ...props }: OtterAssetProps) {
  return (
    <img
      src={otterAssetSrc(asset)}
      alt={alt}
      className={className}
      draggable={draggable}
      {...props}
    />
  )
}
