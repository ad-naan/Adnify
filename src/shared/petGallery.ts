export const PET_GALLERY = [
  { id: 'Hiyori', name: 'Hiyori Momose', image: 'sample-img-hiyori.jpg', page: 'momose-hiyori' },
  { id: 'Mao', name: 'Niziiro Mao', image: 'sample-img-niziiromao.jpg', page: 'niziiro-mao' },
  { id: 'Rice', name: 'Rice Glassfield', image: 'sample-img-rice.jpg', page: 'rice-glassfield' },
] as const

export type PetGalleryModel = typeof PET_GALLERY[number]
export const PET_SAMPLE_TERMS = 'https://www.live2d.com/en/learn/sample/model-terms/'
export const PET_MATERIAL_LICENSE = 'https://www.live2d.com/eula/live2d-free-material-license-agreement_en.html'
