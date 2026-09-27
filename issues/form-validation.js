(() => {
  'use strict';
  function validate(data, formId) {
    const problems = [];
    const field = (key, label, min, max) => {
      const value = String(data[key] || '').trim();
      if (!value) problems.push({ field: key, message: `${label} is required.` });
      else if (value.length < min) problems.push({ field: key, message: `${label} must be at least ${min} characters (currently ${value.length}).` });
      else if (value.length > max) problems.push({ field: key, message: `${label} must be ${max} characters or fewer.` });
    };
    if (formId === 'report-form') {
      if (!data.category) problems.push({ field: 'category', message: 'Please choose a category.' });
      field('title', 'Title', 5, 160);
      field('body', 'Description', 15, 10000);
    } else if (formId === 'comment-form') field('body', 'Comment', 2, 5000);
    return problems;
  }
  window.KollectionIssueForm = Object.freeze({ validate });
})();
