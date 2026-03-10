import React, { useState, useEffect, useRef } from 'react';
import { Image as ImageIcon } from 'lucide-react';

interface LazyImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
    src: string;
    alt?: string;
    className?: string;
    placeholderClassName?: string;
}

export const LazyImage: React.FC<LazyImageProps> = ({
    src,
    alt = '',
    className = '',
    placeholderClassName = '',
    ...props
}) => {
    const [isLoaded, setIsLoaded] = useState(false);
    const [inView, setInView] = useState(false);
    const imgRef = useRef<HTMLImageElement>(null);
    const placeholderRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const observer = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    if (entry.isIntersecting) {
                        setInView(true);
                        observer.disconnect();
                    }
                });
            },
            {
                rootMargin: '100px', // 在距离可视区域 100px 时开始预加载
            }
        );

        if (placeholderRef.current) {
            observer.observe(placeholderRef.current);
        } else if (imgRef.current) {
            observer.observe(imgRef.current);
        }

        return () => {
            observer.disconnect();
        };
    }, []);

    return (
        <div
            className={`relative overflow-hidden ${className}`}
            ref={placeholderRef}
        >
            {/* 骨架屏占位 */}
            {!isLoaded && (
                <div className={`absolute inset-0 flex items-center justify-center bg-surface-muted animate-pulse ${placeholderClassName}`}>
                    <ImageIcon className="w-6 h-6 text-text-muted/30" />
                </div>
            )}

            {/* 真实图片 */}
            {inView && (
                <img
                    ref={imgRef}
                    src={src}
                    alt={alt}
                    className={`w-full h-full object-cover transition-opacity duration-300 ${isLoaded ? 'opacity-100' : 'opacity-0'} ${className}`}
                    onLoad={() => setIsLoaded(true)}
                    {...props}
                />
            )}
        </div>
    );
};
