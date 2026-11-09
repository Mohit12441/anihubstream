// @ts-check

/**
 * Validates a single anime document object.
 * @param {Record<string, any>} doc
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateAnimeDoc(doc) {
  const errors = [];

  if (!doc || typeof doc !== 'object') {
    return { valid: false, errors: ['Document must be an object'] };
  }

  // Required string identifiers
  if (!doc.id || typeof doc.id !== 'string' || doc.id.trim() === '') {
    errors.push('Field "id" is required and must be a non-empty string slug');
  }

  if (!doc.title || typeof doc.title !== 'string' || doc.title.trim() === '') {
    errors.push('Field "title" is required and must be a non-empty string');
  }

  // Year validation
  if (typeof doc.year !== 'number' || doc.year < 1900 || doc.year > 2100) {
    errors.push('Field "year" must be a valid number between 1900 and 2100');
  }

  // Rating validation
  if (typeof doc.rating !== 'number' || doc.rating < 0 || doc.rating > 10) {
    errors.push('Field "rating" must be a number between 0 and 10');
  }

  // Optional string fields type validation if present
  const stringFields = ['native', 'season', 'kind', 'status', 'art', 'key_art', 'accent', 'synopsis'];
  for (const field of stringFields) {
    if (doc[field] !== undefined && typeof doc[field] !== 'string') {
      errors.push(`Field "${field}" must be a string if provided`);
    }
  }

  // Genres validation
  if (doc.genres !== undefined && !Array.isArray(doc.genres)) {
    errors.push('Field "genres" must be an array of strings');
  }

  // Source IDs validation
  if (doc.source_ids !== undefined && (typeof doc.source_ids !== 'object' || doc.source_ids === null)) {
    errors.push('Field "source_ids" must be an object');
  }

  // Episode array validation
  if (doc.episodes !== undefined) {
    if (!Array.isArray(doc.episodes)) {
      errors.push('Field "episodes" must be an array');
    } else {
      doc.episodes.forEach((ep, index) => {
        if (!ep || typeof ep !== 'object') {
          errors.push(`Episode at index ${index} must be an object`);
          return;
        }
        if (typeof ep.n !== 'number' || ep.n <= 0) {
          errors.push(`Episode at index ${index} has invalid episode number "n": ${ep.n}`);
        }
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Validates the canonical genre list.
 * @param {any[]} genres
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateGenreList(genres) {
  const errors = [];

  if (!Array.isArray(genres) || genres.length === 0) {
    return { valid: false, errors: ['Genre list must be a non-empty array'] };
  }

  genres.forEach((g, idx) => {
    if (!g || typeof g !== 'object') {
      errors.push(`Genre at index ${idx} must be an object`);
      return;
    }
    const required = ['id', 'label', 'tagline', 'art', 'accent', 'position'];
    for (const key of required) {
      if (g[key] === undefined || g[key] === null) {
        errors.push(`Genre at index ${idx} is missing required field "${key}"`);
      }
    }
  });

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Validates reference document structures.
 * @param {'provider_routes' | 'franchise_relations' | 'id_map' | 'redirects'} kind
 * @param {any} data
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateReferenceDoc(kind, data) {
  const errors = [];

  if (!Array.isArray(data)) {
    return { valid: false, errors: ['Reference data must be an array'] };
  }

  switch (kind) {
    case 'provider_routes':
      data.forEach((item, idx) => {
        if (!item?.provider_id || !item?.route_pattern) {
          errors.push(`provider_routes row ${idx} missing provider_id or route_pattern`);
        }
      });
      break;

    case 'franchise_relations':
      data.forEach((item, idx) => {
        if (!item?.anime_id || !item?.related_anime_id || !item?.relation_type) {
          errors.push(`franchise_relations row ${idx} missing anime_id, related_anime_id, or relation_type`);
        }
      });
      break;

    case 'id_map':
      data.forEach((item, idx) => {
        if (!item?.anime_id) {
          errors.push(`id_map row ${idx} missing anime_id`);
        }
      });
      break;

    case 'redirects':
      data.forEach((item, idx) => {
        if (!item?.source_slug || !item?.target_slug) {
          errors.push(`redirects row ${idx} missing source_slug or target_slug`);
        }
      });
      break;

    default:
      errors.push(`Unknown reference kind "${kind}"`);
  }

  return {
    valid: errors.length === 0,
    errors
  };
}
