// 零提交插桩:守「填充流程绝不提交表单、绝不点发布」这条硬约束。
// jsdom 不会真导航,故必须靠 spy 计数,否则断言会"假绿"。
// 三个独立通道都要为 0:
//   1. 程序提交 form.submit() / form.requestSubmit()
//   2. submit 事件(原生提交 / requestSubmit 触发)
//   3. 发布按钮被 click

export interface SubmitSpy {
  /** form.submit() + requestSubmit() 调用次数 + submit 事件次数之和。 */
  submitCount(): number;
  /** 发布按钮 click 次数。 */
  publishClickCount(): number;
  /** 还原所有 spy(测试 teardown 调用)。 */
  restore(): void;
}

export function installSubmitSpy(form: HTMLFormElement, publishButton: Element): SubmitSpy {
  let programmaticSubmits = 0;
  let submitEvents = 0;
  let publishClicks = 0;

  const origSubmit = form.submit;
  const origRequestSubmit = form.requestSubmit;

  form.submit = function patchedSubmit() {
    programmaticSubmits += 1;
  } as typeof form.submit;

  if (typeof origRequestSubmit === 'function') {
    form.requestSubmit = function patchedRequestSubmit() {
      programmaticSubmits += 1;
    } as typeof form.requestSubmit;
  }

  const onSubmit = (e: Event) => {
    submitEvents += 1;
    e.preventDefault(); // 防止 jsdom 的"未实现的导航"告警
  };
  const onPublishClick = () => {
    publishClicks += 1;
  };

  form.addEventListener('submit', onSubmit);
  publishButton.addEventListener('click', onPublishClick);

  return {
    submitCount: () => programmaticSubmits + submitEvents,
    publishClickCount: () => publishClicks,
    restore() {
      form.submit = origSubmit;
      // 仅当原本存在 requestSubmit 才还原(patch 时也只在存在时才 patch,保持对称)。
      if (typeof origRequestSubmit === 'function') {
        form.requestSubmit = origRequestSubmit;
      }
      form.removeEventListener('submit', onSubmit);
      publishButton.removeEventListener('click', onPublishClick);
    },
  };
}
