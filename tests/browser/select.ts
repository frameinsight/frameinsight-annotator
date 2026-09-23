import {expect, type Page} from '../../frontend/node_modules/@playwright/test';

/** Exercise the visible shadcn popup, including keyboard/focus and portal state. */
export async function selectOption(page:Page,label:string,option:string|RegExp){
 const trigger=page.getByRole('combobox',{name:label,exact:true});
 await trigger.click();
 const list=page.getByRole('listbox');
 await expect(list).toBeVisible();
 await list.getByRole('option',{name:option,exact:true}).click();
 await expect(list).toHaveCount(0);
 await expect(trigger).toContainText(option);
}
