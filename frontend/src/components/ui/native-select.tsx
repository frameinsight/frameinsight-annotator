import * as React from "react"
import { cn } from "@/lib/utils"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "./select"

type NativeSelectProps = React.AriaAttributes & Pick<React.ComponentProps<"select">,
  "children" | "value" | "defaultValue" | "onChange" | "id" | "name" |
  "disabled" | "required" | "autoComplete" | "form" | "autoFocus" |
  "title" | "className" | "tabIndex"
> & {size?: "sm" | "default"}

type Choice = {kind: "option"; key: React.Key; value: string; label: string; disabled: boolean; hidden: boolean; selected: boolean}
type ChoiceGroup = {kind: "group"; key: React.Key; label: string; choices: ChoiceNode[]}
type ChoiceNode = Choice | ChoiceGroup

function optionText(children: React.ReactNode): string {
  return React.Children.toArray(children).map(child => {
    if (typeof child === "string" || typeof child === "number") return String(child)
    return React.isValidElement<{children?: React.ReactNode}>(child) ? optionText(child.props.children) : ""
  }).join("")
}

function optionTree(children: React.ReactNode, disabled = false): ChoiceNode[] {
  return React.Children.toArray(children).flatMap((child, index): ChoiceNode[] => {
    if (!React.isValidElement<React.ComponentProps<"option"> & {label?: string}>(child)) return []
    const props = child.props
    if (child.type === React.Fragment) return optionTree(props.children, disabled)
    if (child.type === "optgroup" || child.type === NativeSelectOptGroup) {
      return [{kind: "group", key: child.key ?? index, label: props.label ?? "", choices: optionTree(props.children, disabled || !!props.disabled)}]
    }
    if (child.type !== "option" && child.type !== NativeSelectOption) return []
    const text = optionText(props.children)
    return [{kind: "option", key: child.key ?? index, value: props.value === undefined ? text : String(props.value), label: props.label ?? text, disabled: disabled || !!props.disabled, hidden: !!props.hidden, selected: !!props.selected}]
  })
}

function flattenChoices(nodes: ChoiceNode[]): Choice[] {
  return nodes.flatMap(node => node.kind === "group" ? flattenChoices(node.choices) : [node])
}

/**
 * Compatibility boundary for existing option-based forms. The visible control
 * and popup are the preset's Select; handlers retain their target.value API.
 * New forms can use the Select components directly with onValueChange.
 */
function NativeSelect({
  children, className, size = "default", value, defaultValue, onChange,
  disabled = false, required, name, form, autoComplete, ...triggerProps
}: NativeSelectProps) {
  const tree = React.useMemo(() => optionTree(children), [children])
  const choices = React.useMemo(() => flattenChoices(tree), [tree])
  const [localValue, setLocalValue] = React.useState(() => String(defaultValue ?? choices.find(choice => choice.selected)?.value ?? choices[0]?.value ?? ""))
  const selectedValue = value === undefined ? localValue : String(value)
  const selected = choices.find(choice => choice.value === selectedValue)
  const trigger = React.useRef<HTMLButtonElement>(null)
  const [fieldsetDisabled, setFieldsetDisabled] = React.useState(false)
  const [open, setOpen] = React.useState(false)
  const [invalid, setInvalid] = React.useState(false)
  const instanceId = React.useId()
  let emptyMenuValue = `empty:${instanceId}`
  while (choices.some(choice => choice.value === emptyMenuValue)) emptyMenuValue += ":"
  const isDisabled = disabled || fieldsetDisabled || !choices.length

  // Native fieldsets disable descendant buttons. The popup is portaled, so its
  // state must also follow disabled ancestors (including the first-legend rule).
  React.useEffect(() => {
    const button = trigger.current
    if (!button) return
    const fieldsets: HTMLFieldSetElement[] = []
    for (let parent = button.parentElement; parent; parent = parent.parentElement) {
      if (parent instanceof HTMLFieldSetElement) fieldsets.push(parent)
    }
    const refresh = () => setFieldsetDisabled(fieldsets.some(fieldset => {
      const firstLegend = Array.from(fieldset.children).find(child => child.tagName === "LEGEND")
      return fieldset.disabled && !firstLegend?.contains(button)
    }))
    refresh()
    const observer = new MutationObserver(refresh)
    fieldsets.forEach(fieldset => observer.observe(fieldset, {attributes: true, attributeFilter: ["disabled"]}))
    return () => observer.disconnect()
  }, [])

  React.useEffect(() => { if (isDisabled) setOpen(false) }, [isDisabled])

  function change(next: string) {
    if (isDisabled || trigger.current?.matches(":disabled")) return
    // Radix mirrors its options into a hidden form select. Replacing that option
    // list can briefly emit "" (or a removed value) before its new options mount.
    // A deliberate empty choice always arrives through our nonempty menu token.
    if (!next || (next !== emptyMenuValue && !choices.some(choice => choice.value === next))) return
    const nextValue = next === emptyMenuValue ? "" : next
    if (nextValue === selectedValue) return
    setLocalValue(nextValue)
    setInvalid(false)
    // Existing callers only read target.value. This adapter does not dispatch a
    // DOM select change; parent form logic should use explicit change handlers.
    const target = {value: nextValue, name: name ?? "", id: triggerProps.id ?? ""} as HTMLSelectElement
    const nativeEvent = new Event("change")
    onChange?.({
      target, currentTarget: target, nativeEvent, type: "change",
      bubbles: true, cancelable: false, defaultPrevented: false,
      eventPhase: 2, isTrusted: false, timeStamp: nativeEvent.timeStamp,
      preventDefault() {}, stopPropagation() {}, persist() {},
      isDefaultPrevented: () => false, isPropagationStopped: () => false,
    } as React.ChangeEvent<HTMLSelectElement>)
  }

  function renderChoices(nodes: ChoiceNode[]): React.ReactNode {
    return nodes.map(node => node.kind === "group" ? (
      <SelectGroup key={node.key}>
        <SelectLabel>{node.label}</SelectLabel>
        {renderChoices(node.choices)}
      </SelectGroup>
    ) : node.hidden ? null : (
      <SelectItem key={node.key} value={node.value || emptyMenuValue} disabled={node.disabled} textValue={node.label}>
        {node.label}
      </SelectItem>
    ))
  }

  return (
    <div className={cn("min-w-0", className)} data-slot="native-select-wrapper" data-size={size}
      onInvalidCapture={() => {setInvalid(true); trigger.current?.focus()}}>
      <Select value={selectedValue} onValueChange={change} open={open}
        onOpenChange={next => setOpen(next && !isDisabled && !trigger.current?.matches(":disabled"))}
        disabled={isDisabled} required={required} name={name} form={form} autoComplete={autoComplete}>
        <SelectTrigger {...triggerProps} ref={trigger} size={size} className="w-full min-w-0"
          aria-invalid={triggerProps["aria-invalid"] || invalid || undefined}>
          <SelectValue placeholder={selected?.label || choices.find(choice => choice.value === "")?.label || "Choose an option"}>
            {selectedValue ? selected?.label ?? selectedValue : undefined}
          </SelectValue>
        </SelectTrigger>
        <SelectContent position="popper" align="start" className="max-w-[calc(100vw-2rem)]">
          <SelectGroup>{renderChoices(tree)}</SelectGroup>
        </SelectContent>
      </Select>
      {invalid && <p role="alert" className="mt-1 text-xs text-destructive">Choose an option.</p>}
    </div>
  )
}

function NativeSelectOption(props: React.ComponentProps<"option">) {
  return <option {...props}/>
}

function NativeSelectOptGroup(props: React.ComponentProps<"optgroup">) {
  return <optgroup {...props}/>
}

export {NativeSelect, NativeSelectOptGroup, NativeSelectOption}
